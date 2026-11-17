import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ArticleV1 } from 'datastore/article';
import { EmbeddingEvent } from 'shared/embeddingEvent';
import { embedText } from './marengo.ts';
import { writeArticle } from './opensearch.ts';

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

	const { headline, standfirst, keywordTagIds, internalRevision } =
		event.payload;

	const [headlineEmbedded, standfirstEmbedded, combinedEmbedded] = (
		await Promise.allSettled([
			embedded(headline),
			embedded(standfirst),
			embedded(`${headline}\n${standfirst}`),
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
		headlineAndStandfirst: combinedEmbedded,
		keywordTagIds,
		internalRevision,
		storedAt: new Date().toISOString(),
	});

	await writeArticle(articleId, document, internalRevision);
	console.log('Stored article', {
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
