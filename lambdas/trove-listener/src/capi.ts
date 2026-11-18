import { randomUUID } from 'node:crypto';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import type { UpdateEmbeddingEvent } from 'shared/embeddingEvent';

interface CapiResponse {
	response?: {
		content?: CapiContent;
	};
}

export interface CapiContent {
	id: string;
	type: 'article' | 'liveblog';
	webPublicationDate?: string;
	fields?: {
		headline?: string;
		standfirst?: string;
		trailText?: string;
		byline?: string;
		internalRevision?: number;
		liveBloggingNow?: boolean;
	};
	tags?: Array<{ id: string; type: string }>;
}

export async function fetchCapiContent(
	capiUrl: string,
	apiKey: string | undefined,
): Promise<CapiContent> {
	const url = new URL(capiUrl);
	url.searchParams.set(
		'show-fields',
		'headline,standfirst,trailText,byline,internalRevision,liveBloggingNow',
	);
	url.searchParams.set('show-tags', 'keyword');
	if (apiKey) {
		url.searchParams.set('api-key', apiKey);
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

export function crierContentToEmbeddingEvent(
	content: Content,
	internalRevisionFallback: number | undefined,
): UpdateEmbeddingEvent {
	const fields = content.fields;
	const headline = fields?.headline ?? content.webTitle;
	const standfirst = fields?.standfirst ?? fields?.trailText ?? '';
	const byline = fields?.byline ?? '';
	const internalRevision =
		fields?.internalRevision ?? internalRevisionFallback ?? 0;
	const webPublicationDate = content.webPublicationDate?.iso8601;
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
				content.type === ContentType.LIVEBLOG ? 'liveblog' : 'article',
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

export function capiContentToEmbeddingEvent(
	content: CapiContent,
	internalRevisionFallback: number | undefined,
): UpdateEmbeddingEvent {
	const fields = content.fields;
	const headline = fields?.headline ?? '';
	const standfirst = fields?.standfirst ?? fields?.trailText ?? '';
	const byline = fields?.byline ?? '';
	const internalRevision =
		fields?.internalRevision ?? internalRevisionFallback ?? 0;
	if (!content.webPublicationDate) {
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
				content.type === 'liveblog' || fields?.liveBloggingNow
					? 'liveblog'
					: 'article',
			headline,
			standfirst,
			keywordTagIds: (content.tags ?? [])
				.filter((tag) => tag.type === 'keyword')
				.map((tag) => tag.id),
			internalRevision,
			webPublicationDate: content.webPublicationDate,
		},
	};
}
