import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { KinesisStreamEvent } from 'aws-lambda';
import { awsClientConfig } from 'shared/aws';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import type { FetchContent } from './toEmbeddingEvent.ts';
import { toEmbeddingEvent } from './toEmbeddingEvent.ts';

const sqs = new SQSClient(awsClientConfig);

/**
 * The Kinesis batch size matches the SQS batch limit (10), so a batch is sent in a single request.
 * Any failure fails the whole batch, which Kinesis then retries.
 */
export async function processBatch(
	event: KinesisStreamEvent,
	fetchContent: FetchContent,
	queueUrl: string,
): Promise<void> {
	const results = await Promise.allSettled(
		event.Records.map(async (record) =>
			toEmbeddingEvent(
				decodeAndParseCrierEvent(record.kinesis.data),
				fetchContent,
			),
		),
	);
	const failure = results.find((result) => result.status === 'rejected');
	if (failure) {
		throw failure.reason;
	}
	const embeddingEvents = results.flatMap((result) => {
		if (result.status === 'rejected' || result.value === undefined) {
			return [];
		}
		return [result.value];
	});

	if (embeddingEvents.length === 0) {
		return;
	}

	const { Failed = [] } = await sqs.send(
		new SendMessageBatchCommand({
			QueueUrl: queueUrl,
			Entries: embeddingEvents.map((e) => ({
				Id: e.embeddingEventId,
				MessageBody: JSON.stringify(e),
			})),
		}),
	);
	if (Failed.length > 0) {
		throw new Error(
			`Failed to send ${Failed.length} messages to SQS: ${JSON.stringify(Failed)}`,
		);
	}
	console.log(`Sent ${embeddingEvents.length} messages to SQS`);
}
