import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ArticleV1 } from 'datastore/article';
import { EmbeddingEvent } from 'shared/embeddingEvent';
import { embedText } from './marengo.ts';

const embedded = async (value: string) => ({
	value,
	embeddings: { marengo_3_0: await embedText(value) },
});

async function processRecord(record: SQSRecord): Promise<void> {
	const event = EmbeddingEvent.parse(JSON.parse(record.body));
	const { embeddingEventId, source } = event;
	const { articleId } = event.payload;

	if (event.eventType === 'delete') {
		console.log('Skipping delete event, not yet supported', {
			embeddingEventId,
			source,
			articleId,
		});
		return;
	}

	const payload = event.payload;

	const [
		headlineEmbedded,
		standfirstEmbedded,
		combinedEmbedded,
		bodyTextPreviewEmbedded,
	] = (
		await Promise.allSettled([
			embedded(payload.headline),
			payload.standfirst === undefined
				? undefined
				: embedded(payload.standfirst),
			embedded(
				payload.standfirst === undefined
					? payload.headline
					: `${payload.headline}\n${payload.standfirst}`,
			),
			embedded(payload.bodyTextPreview),
		])
	).map((result) => {
		if (result.status === 'rejected') {
			throw result.reason as unknown;
		}
		return result.value;
	});

	const document = ArticleV1.parse({
		headline: headlineEmbedded,
		standfirst: standfirstEmbedded,
		byline: payload.byline,
		articleType: payload.articleType,
		sectionId: payload.sectionId,
		pillarId: payload.pillarId,
		headlineAndStandfirst: combinedEmbedded,
		bodyTextPreview: bodyTextPreviewEmbedded,
		toneTagIds: payload.toneTagIds,
		keywordTagIds: payload.keywordTagIds,
		internalRevision: payload.internalRevision,
		wordCount: payload.wordCount,
		storedAt: new Date().toISOString(),
		webPublicationDate: payload.webPublicationDate,
		firstPublicationDate: payload.firstPublicationDate,
	});

	// TODO: write `document` to OpenSearch with `_id` = articleId
	console.log('Embedded article', {
		embeddingEventId,
		source,
		articleId,
		internalRevision: document.internalRevision,
	});
}

/** Processes records concurrently, reporting failed ones so only they are retried. */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
	console.log(`Received ${event.Records.length} messages`);
	for (const record of event.Records) {
		console.log(
			`Message ${record.messageId} from ${record.eventSourceARN}: ${record.body}`,
		);
	}

	const results = await Promise.allSettled(event.Records.map(processRecord));

	const batchItemFailures = event.Records.flatMap((record, i) => {
		const result = results[i];
		if (result?.status !== 'rejected') {
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
