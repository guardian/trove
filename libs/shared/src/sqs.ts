import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { awsClientConfig } from './aws.ts';
import type { EmbeddingEvent } from './embeddingEvent.ts';

const sqs = new SQSClient(awsClientConfig);

// The maximum number of messages in a single SendMessageBatch request
const maxBatchSize = 10;

/** Sends embedding events to the queue in batches, throwing if any message fails to send. */
export async function sendEmbeddingEvents(
	queueUrl: string,
	events: EmbeddingEvent[],
): Promise<void> {
	for (let i = 0; i < events.length; i += maxBatchSize) {
		const batch = events.slice(i, i + maxBatchSize);
		const { Failed = [] } = await sqs.send(
			new SendMessageBatchCommand({
				QueueUrl: queueUrl,
				Entries: batch.map((e) => ({
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
	}
	console.log(`Sent ${events.length} messages to SQS`);
}
