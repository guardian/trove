import type { SQSClient } from '@aws-sdk/client-sqs';
import {
	GetQueueAttributesCommand,
	SendMessageBatchCommand,
} from '@aws-sdk/client-sqs';
import type { EmbeddingEvent } from 'shared/src/embeddingEvent.ts';

const SQS_MAX_BATCH_SIZE = 10;

export function createQueue(sqs: SQSClient, queueUrl: string) {
	return {
		send: async (events: EmbeddingEvent[]): Promise<void> => {
			for (let i = 0; i < events.length; i += SQS_MAX_BATCH_SIZE) {
				const batch = events.slice(i, i + SQS_MAX_BATCH_SIZE);
				const { Failed } = await sqs.send(
					new SendMessageBatchCommand({
						QueueUrl: queueUrl,
						Entries: batch.map((event) => ({
							Id: event.embeddingEventId,
							MessageBody: JSON.stringify(event),
						})),
					}),
				);
				if (Failed?.length) {
					throw new Error(
						`Failed to enqueue ${Failed.length} messages: ${JSON.stringify(Failed)}`,
					);
				}
			}
		},

		depth: async (): Promise<number> => {
			const { Attributes } = await sqs.send(
				new GetQueueAttributesCommand({
					QueueUrl: queueUrl,
					AttributeNames: ['ApproximateNumberOfMessages'],
				}),
			);
			const depth = Number(Attributes?.ApproximateNumberOfMessages);
			if (!Number.isInteger(depth) || depth < 0) {
				throw new Error('SQS returned an invalid or missing queue depth');
			}
			return depth;
		},
	};
}
