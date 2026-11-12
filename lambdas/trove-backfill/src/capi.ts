import { randomUUID } from 'node:crypto';
import type { UpdateEmbeddingEvent } from 'shared/src/embeddingEvent.ts';
import { UpdateEmbeddingEvent as UpdateEmbeddingEventSchema } from 'shared/src/embeddingEvent.ts';

export type CapiContent = {
	id: string;
	type: string;
	webPublicationDate: string;
	fields?: {
		headline?: string;
		standfirst?: string;
		byline?: string;
		internalRevision?: string;
	};
	tags?: Array<{ id: string; type: string }>;
};

type CapiResponse = { response: { results: CapiContent[] } };

export type CapiQuery = {
	baseUrl: string;
	apiKey: string;
	pageSize: number;
	fromDate?: string;
	toDate?: string;
};

/**
 * Deliberately independent of the ECS implementation so either can be removed.
 * Uses /search initially, then /content/{lastSeenId}/next to avoid deep paging.
 * @see https://github.com/guardian/content-api/pull/2812
 */
export function createCapiPageFetcher(query: CapiQuery) {
	const params = new URLSearchParams({
		'order-by': 'oldest',
		'use-date': 'published',
		'page-size': String(query.pageSize),
		'show-fields': 'headline,standfirst,byline,internalRevision',
		'show-tags': 'keyword',
		'api-key': query.apiKey,
	});
	if (query.fromDate) {
		params.set('from-date', query.fromDate);
	}
	if (query.toDate) {
		params.set('to-date', query.toDate);
	}

	return async (afterId: string | undefined): Promise<CapiContent[]> => {
		const path = afterId ? `content/${afterId}/next` : 'search';
		const url = `${query.baseUrl}/${path}?${params.toString()}`;
		const body = (await fetchWithRetry(url)) as CapiResponse;
		return body.response.results;
	};
}

async function fetchWithRetry(url: string, attempts = 3): Promise<unknown> {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
			if (!res.ok) {
				throw new Error(`CAPI responded ${res.status}`);
			}
			const json = await res.json();
			return json;
		} catch (error) {
			if (attempt >= attempts) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
		}
	}
}

export function toEmbeddingEvent(
	content: CapiContent,
): UpdateEmbeddingEvent | undefined {
	const result = UpdateEmbeddingEventSchema.safeParse({
		embeddingEventId: randomUUID(),
		source: 'backfiller',
		eventType: 'update',
		payload: {
			articleId: content.id,
			byline: content.fields?.byline ?? '',
			articleType: content.type,
			headline: content.fields?.headline ?? '',
			standfirst: content.fields?.standfirst ?? '',
			keywordTagIds: (content.tags ?? [])
				.filter((tag) => tag.type === 'keyword')
				.map((tag) => tag.id),
			internalRevision: Number(content.fields?.internalRevision),
			webPublicationDate: content.webPublicationDate,
		},
	});
	return result.success ? result.data : undefined;
}
