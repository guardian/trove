import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { KinesisStreamEvent } from 'aws-lambda';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import type { FetchContent } from './toEmbeddingEvent.ts';
import { toEmbeddingEvent } from './toEmbeddingEvent.ts';

const sqs = new SQSClient({});

/**
 * The Kinesis batch size matches the SQS batch limit (10), so a batch is sent in a single request.
 * Any failure fails the whole batch, which Kinesis then retries.
 */
export async function processBatch(
	event: KinesisStreamEvent,
	fetchContent: FetchContent,
	queueUrl: string | undefined,
): Promise<void> {
	const embeddingEvents = (
		await Promise.all(
			event.Records.map((record) =>
				toEmbeddingEvent(
					decodeAndParseCrierEvent(record.kinesis.data),
					fetchContent,
				),
			),
		)
	).filter((e) => e !== undefined);

	if (embeddingEvents.length === 0) {
		return;
	}
	if (!queueUrl) {
		console.log('No LIVE_EMBEDDER_QUEUE_URL set, so logging messages instead');
		embeddingEvents.forEach((e) => console.log(JSON.stringify(e)));
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
