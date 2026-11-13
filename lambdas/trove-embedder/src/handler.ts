import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { EmbeddingEvent } from 'shared/embeddingEvent';
import type { Embed } from './marengo.ts';
import { toArticleV1 } from './toArticle.ts';

type Dependencies = {
	embed: Embed;
	now?: () => Date;
};

const processRecord = async (
	record: SQSRecord,
	{ embed, now = () => new Date() }: Dependencies,
): Promise<void> => {
	const event = EmbeddingEvent.parse(JSON.parse(record.body));

	switch (event.eventType) {
		case 'delete':
			console.log('Skipping delete event, not yet supported', {
				embeddingEventId: event.embeddingEventId,
				source: event.source,
				articleId: event.payload.articleId,
			});
			return;
		case 'update': {
			const document = await toArticleV1(event.payload, embed, now());
			// TODO: write `document` to OpenSearch with `_id` = articleId
			console.log('Embedded article', {
				embeddingEventId: event.embeddingEventId,
				source: event.source,
				articleId: event.payload.articleId,
				internalRevision: document.internalRevision,
			});
			return;
		}
	}
};

/** Processes records concurrently, reporting failed ones so only they are retried. */
export const createHandler =
	(dependencies: Dependencies) =>
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const results = await Promise.allSettled(
			event.Records.map((record) => processRecord(record, dependencies)),
		);

		const batchItemFailures = results.flatMap((result, i) => {
			const record = event.Records[i];
			if (result.status === 'fulfilled' || !record) {
				return [];
			}
			console.error('Failed to process message', {
				messageId: record.messageId,
				error: result.reason as unknown,
			});
			return [{ itemIdentifier: record.messageId }];
		});

		return { batchItemFailures };
	};
