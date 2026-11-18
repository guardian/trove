import { randomUUID } from 'node:crypto';
import type { CapiDateTime } from '@guardian/content-api-models/v1/capiDateTime.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import type { ItemResponse } from '@guardian/content-api-models/v1/itemResponse.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import type { UpdateEmbeddingEvent } from 'shared/embeddingEvent';

interface CapiResponse {
	response?: ItemResponse;
}

export async function fetchCapiContent(
	capiUrl: string,
	capiKey: string | undefined,
): Promise<Content> {
	const url = new URL(capiUrl);
	url.searchParams.set(
		'show-fields',
		'headline,standfirst,trailText,byline,internalRevision,liveBloggingNow',
	);
	url.searchParams.set('show-tags', 'keyword');
	if (capiKey) {
		url.searchParams.set('api-key', capiKey);
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`CAPI request failed with status ${response.status}`);
	}

	const body = (await response.json()) as CapiResponse;
	if (!body.response?.content) {
		throw new Error('CAPI response did not contain content');
	}
	return body.response.content;
}

export function contentToEmbeddingEvent(
	content: Content,
	internalRevisionFallback: number | undefined,
): UpdateEmbeddingEvent {
	const fields = content.fields;
	const headline = fields?.headline ?? content.webTitle;
	const standfirst = fields?.standfirst ?? fields?.trailText ?? '';
	const byline = fields?.byline ?? '';
	const internalRevision =
		fields?.internalRevision ?? internalRevisionFallback ?? 0;
	const webPublicationDate = getWebPublicationDate(content.webPublicationDate);
	if (!webPublicationDate) {
		throw new Error(`Content ${content.id} has no web publication date`);
	}

	return {
		embeddingEventId: randomUUID(),
		source: 'listener',
		eventType: 'update',
		payload: {
			articleId: content.id,
			byline,
			articleType:
				content.type === ContentType.LIVEBLOG || fields?.liveBloggingNow
					? 'liveblog'
					: 'article',
			headline,
			standfirst,
			keywordTagIds: content.tags
				.filter((tag) => tag.type === TagType.KEYWORD)
				.map((tag) => tag.id),
			internalRevision,
			webPublicationDate,
		},
	};
}

function getWebPublicationDate(
	value: CapiDateTime | string | undefined,
): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	return value?.iso8601;
}
