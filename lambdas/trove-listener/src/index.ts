import { randomUUID } from 'node:crypto';
import {
	SendMessageBatchCommand,
	type SendMessageBatchCommandOutput,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import type { KinesisStreamHandler, KinesisStreamRecord } from 'aws-lambda';
import {
	type DeleteEmbeddingEvent,
	EmbeddingEvent,
	type EmbeddingEvent as EmbeddingEventType,
	type UpdateEmbeddingEvent,
} from 'shared/embeddingEvent';
import { contentToEmbeddingEvent, fetchCapiContent } from './capi.ts';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';

const queueUrl = process.env.LIVE_EMBEDDER_QUEUE_URL;
const awsRegion = process.env.AWS_REGION ?? 'eu-west-1';
// GuCDK sets STAGE in deployed Lambdas. Locally use the Janus capi profile.
const credentials = process.env.STAGE
	? defaultProvider()
	: defaultProvider({ profile: 'capi' });
const sqs = new SQSClient({ region: awsRegion, credentials });

interface ListenerDependencies {
	queueUrl: string;
	sendBatch: (
		command: SendMessageBatchCommand,
	) => Promise<SendMessageBatchCommandOutput>;
	getCapiKey: () => Promise<string | undefined>;
	fetchCapiContent: (
		capiUrl: string,
		capiKey: string | undefined,
	) => Promise<Content>;
}

export function createListenerHandler(
	dependencies: ListenerDependencies,
): KinesisStreamHandler {
	return async (event) => {
		const messages: Array<{ sequenceNumber: string; body: string }> = [];

		for (const record of event.Records) {
			try {
				const embeddingEvent = await processRecord(record, dependencies);
				if (embeddingEvent) {
					messages.push({
						sequenceNumber: record.kinesis.sequenceNumber,
						body: JSON.stringify(embeddingEvent),
					});
				}
			} catch (error) {
				console.error('Failed to process listener record', {
					sequenceNumber: record.kinesis.sequenceNumber,
					error,
				});
				throw error;
			}
		}

		if (messages.length === 0) {
			return;
		}

		try {
			const response = await dependencies.sendBatch(
				new SendMessageBatchCommand({
					QueueUrl: dependencies.queueUrl,
					Entries: messages.map((message, index) => ({
						Id: String(index),
						MessageBody: message.body,
					})),
				}),
			);
			if (response.Failed && response.Failed.length > 0) {
				for (const failure of response.Failed) {
					const message = messages[Number(failure.Id)];
					console.error('Failed to push listener message to SQS', {
						sequenceNumber: message?.sequenceNumber,
						sqsEntryId: failure.Id,
						sqsCode: failure.Code,
						sqsMessage: failure.Message,
					});
				}
				throw new Error('One or more SQS messages failed to send');
			}
		} catch (error) {
			console.error('Failed to push SQS batch', { error });
			throw error;
		}
	};
}

async function processRecord(
	record: KinesisStreamRecord,
	dependencies: ListenerDependencies,
): Promise<EmbeddingEventType | undefined> {
	const crierEvent = decodeAndParseCrierEvent(record.kinesis.data);
	if (crierEvent.itemType !== ItemType.CONTENT) {
		return undefined;
	}
	const id =
		crierEvent.payload?.kind === 'retrievableContent'
			? crierEvent.payload.retrievableContent.id
			: crierEvent.payloadId;

	if (crierEvent.eventType === EventType.DELETE) {
		const event: DeleteEmbeddingEvent = {
			embeddingEventId: randomUUID(),
			source: 'listener',
			eventType: 'delete',
			payload: { articleId: id },
		};
		return event;
	}
	const updateEventTypes: number[] = [
		EventType.UPDATE,
		EventType.RETRIEVABLEUPDATE,
	];
	if (!updateEventTypes.includes(crierEvent.eventType)) {
		return undefined;
	}

	let event: UpdateEmbeddingEvent;
	if (crierEvent.payload?.kind === 'content') {
		event = contentToEmbeddingEvent(crierEvent.payload.content, undefined);
	} else {
		const retrievable =
			crierEvent.payload?.kind === 'retrievableContent'
				? crierEvent.payload.retrievableContent
				: undefined;
		const capiUrl =
			retrievable?.capiUrl ?? `https://content.guardianapis.com/${id}`;
		const capiKey = await dependencies.getCapiKey();
		const content = await dependencies.fetchCapiContent(capiUrl, capiKey);
		event = contentToEmbeddingEvent(content, retrievable?.internalRevision);
	}

	const parsedEvent = EmbeddingEvent.parse(event);
	return parsedEvent;
}

function getCapiKey(): Promise<string | undefined> {
	return Promise.resolve(process.env.CAPI_API_KEY);
}

export const handler = createListenerHandler({
	queueUrl: queueUrl ?? '',
	sendBatch: (command) => sqs.send(command),
	getCapiKey,
	fetchCapiContent,
});
