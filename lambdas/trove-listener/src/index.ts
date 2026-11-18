import { randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type {
	KinesisStreamBatchResponse,
	KinesisStreamHandler,
	KinesisStreamRecord,
} from 'aws-lambda';
import {
	type DeleteEmbeddingEvent,
	EmbeddingEvent,
	type UpdateEmbeddingEvent,
} from 'shared/embeddingEvent';
import {
	type CapiContent,
	capiContentToEmbeddingEvent,
	crierContentToEmbeddingEvent,
	fetchCapiContent,
} from './capi.ts';
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
	send: (command: SendMessageCommand) => Promise<unknown>;
	getCapiApiKey: () => Promise<string | undefined>;
	fetchCapiContent: (
		capiUrl: string,
		apiKey: string | undefined,
	) => Promise<CapiContent>;
}

export function createListenerHandler(
	dependencies: ListenerDependencies,
): KinesisStreamHandler {
	return async (event) => {
		const latestRecords = new Map<
			string,
			{ record: KinesisStreamRecord; time: number }
		>();
		const decodeFailures = new Set<string>();

		for (const record of event.Records) {
			try {
				const crierEvent = decodeAndParseCrierEvent(record.kinesis.data);
				if (crierEvent.itemType !== ItemType.CONTENT) {
					continue;
				}
				const id =
					crierEvent.payload?.kind === 'retrievableContent'
						? crierEvent.payload.retrievableContent.id
						: crierEvent.payloadId;
				const time = crierEvent.dateTime.toNumber();
				const latest = latestRecords.get(id);
				if (!latest || time >= latest.time) {
					latestRecords.set(id, { record, time });
				}
			} catch (error) {
				decodeFailures.add(record.kinesis.sequenceNumber);
				console.error('Failed to decode Kinesis record', {
					sequenceNumber: record.kinesis.sequenceNumber,
					error,
				});
			}
		}

		const results = await Promise.all(
			Array.from(latestRecords.entries()).map(async ([id, latest]) =>
				processRecord(latest.record, id, dependencies).then(
					() => undefined,
					(error: unknown) => {
						console.error('Failed to process listener record', {
							sequenceNumber: latest.record.kinesis.sequenceNumber,
							error,
						});
						return latest.record.kinesis.sequenceNumber;
					},
				),
			),
		);

		const batchItemFailures = results
			.filter((sequenceNumber): sequenceNumber is string => !!sequenceNumber)
			.map((itemIdentifier) => ({ itemIdentifier }));
		for (const itemIdentifier of decodeFailures) {
			batchItemFailures.push({ itemIdentifier });
		}
		return { batchItemFailures } satisfies KinesisStreamBatchResponse;
	};
}

async function processRecord(
	record: KinesisStreamRecord,
	id: string,
	dependencies: ListenerDependencies,
): Promise<void> {
	const crierEvent = decodeAndParseCrierEvent(record.kinesis.data);

	if (crierEvent.eventType === EventType.DELETE) {
		const event: DeleteEmbeddingEvent = {
			embeddingEventId: randomUUID(),
			source: 'listener',
			eventType: 'delete',
			payload: { articleId: id },
		};
		await dependencies.send(
			new SendMessageCommand({
				QueueUrl: dependencies.queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);
		return;
	}

	let event: UpdateEmbeddingEvent;
	if (crierEvent.payload?.kind === 'content') {
		event = crierContentToEmbeddingEvent(crierEvent.payload.content, undefined);
	} else {
		const retrievable =
			crierEvent.payload?.kind === 'retrievableContent'
				? crierEvent.payload.retrievableContent
				: undefined;
		const capiUrl =
			retrievable?.capiUrl ?? `https://content.guardianapis.com/${id}`;
		const capiApiKey = await dependencies.getCapiApiKey();
		const content = await dependencies.fetchCapiContent(capiUrl, capiApiKey);
		event = capiContentToEmbeddingEvent(content, retrievable?.internalRevision);
	}

	const parsedEvent = EmbeddingEvent.parse(event);
	await dependencies.send(
		new SendMessageCommand({
			QueueUrl: dependencies.queueUrl,
			MessageBody: JSON.stringify(parsedEvent),
		}),
	);
}

function getCapiApiKey(): Promise<string | undefined> {
	return Promise.resolve(process.env.CAPI_API_KEY);
}

export const handler = createListenerHandler({
	queueUrl: queueUrl ?? '',
	send: (command) => sqs.send(command),
	getCapiApiKey,
	fetchCapiContent,
});
