import { randomUUID } from 'node:crypto';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import type { SearchResponse } from '@guardian/content-api-models/v1/searchResponse.js';
import { contentToPayload } from 'shared/contentToPayload';
import type { UpdateEmbeddingEvent } from 'shared/embeddingEvent';

export type SearchPage = () => Promise<SearchResponse>;
export type SendEvents = (events: UpdateEmbeddingEvent[]) => Promise<void>;

/** Fetches the first page of the backfill query and sends the content we embed to the embedder. */
export async function backfillFirstPage(
	searchPage: SearchPage,
	sendEvents: SendEvents,
): Promise<void> {
	const { results, total, pages } = await searchPage();
	console.log(`CAPI has ${total} items to backfill over ${pages} pages`);

	const events = results.flatMap((content): UpdateEmbeddingEvent[] => {
		const payload = contentToPayload(content);
		if (!payload) {
			console.log(`Skipping ${content.id} (type ${ContentType[content.type]})`);
			return [];
		}
		return [
			{
				embeddingEventId: randomUUID(),
				source: 'backfiller',
				eventType: 'update',
				payload,
			},
		];
	});

	if (events.length > 0) {
		await sendEvents(events);
	}
	console.log(
		`Sent ${events.length} of ${results.length} items, skipped ${results.length - events.length}. Last seen ID: ${results.at(-1)?.id}`,
	);
}
