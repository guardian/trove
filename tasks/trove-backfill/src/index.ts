import { randomUUID } from 'node:crypto';
import {
	GetQueueUrlCommand,
	SendMessageCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import type { UpdateEmbeddingEvent } from 'shared/src/embeddingEvent.ts';

const stage = process.env.STAGE;
if (!stage) {
	throw new Error('Missing STAGE (e.g. CODE)');
}

const sqs = new SQSClient({ region: 'eu-west-1' });

async function main() {
	const queueName = `trove-embedder-backfill-${stage}`;
	const { QueueUrl: queueUrl } = await sqs.send(
		new GetQueueUrlCommand({ QueueName: queueName }),
	);
	console.log(`Sending to ${queueUrl}`);

	for (let i = 1; i <= 10; i++) {
		const event: UpdateEmbeddingEvent = {
			embeddingEventId: randomUUID(),
			source: 'backfiller',
			eventType: 'update',
			payload: {
				articleId: `test/backfill/${i}`,
				byline: 'Test Author',
				articleType: 'article',
				headline: `Test headline ${i}`,
				standfirst: `Test standfirst ${i}`,
				keywordTagIds: [],
				internalRevision: 1,
				webPublicationDate: new Date().toISOString(),
			},
		};
		console.log(`Sending test event ${i}: ${event.payload.articleId}`);
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify(event),
			}),
		);
	}

	console.log('Sent 10 test events');
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
