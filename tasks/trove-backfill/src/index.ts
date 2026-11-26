import { randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { awsClientConfig } from 'shared/aws';
import type { UpdateEmbeddingEvent } from 'shared/embeddingEvent';

const queueUrl = process.env.BACKFILL_EMBEDDER_QUEUE_URL;
if (!queueUrl) {
	console.log(
		'No BACKFILL_EMBEDDER_QUEUE_URL set, so logging messages instead of sending them',
	);
}

const sqs = new SQSClient(awsClientConfig);

async function main() {
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
				sectionId: 'test',
				pillarId: 'news',
				standfirst: `Test standfirst ${i}`,
				bodyTextPreview: `Test body preview ${i}`,
				toneTagIds: ['tone/news'],
				keywordTagIds: [],
				internalRevision: 1,
				wordCount: 4,
				webPublicationDate: new Date().toISOString(),
				firstPublicationDate: new Date().toISOString(),
			},
		};
		const messageBody = JSON.stringify(event);
		if (!queueUrl) {
			console.log(`Would send test event ${i}: ${messageBody}`);
			continue;
		}
		console.log(`Sending test event ${i}: ${event.payload.articleId}`);
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: messageBody,
			}),
		);
	}

	console.log(queueUrl ? 'Sent 10 test events' : 'Logged 10 test events');
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
