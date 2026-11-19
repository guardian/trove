import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import { UpdateEmbeddingPayload } from './embeddingEvent.ts';

const articleTypes = {
	[ContentType.ARTICLE]: 'article',
	[ContentType.LIVEBLOG]: 'liveblog',
} as const;

/**
 * Maps CAPI content to an embedding payload. Returns undefined for content we don't embed,
 * silently for other content types, with a warning when an article is missing a required property.
 */
export function contentToPayload(
	content: Content,
): UpdateEmbeddingPayload | undefined {
	if (
		content.type !== ContentType.ARTICLE &&
		content.type !== ContentType.LIVEBLOG
	) {
		return undefined;
	}

	const { fields, webPublicationDate } = content;
	const result = UpdateEmbeddingPayload.safeParse({
		articleId: content.id,
		byline: fields?.byline ?? '',
		articleType: articleTypes[content.type],
		headline: fields?.headline,
		standfirst: fields?.standfirst ?? '',
		keywordTagIds: content.tags
			.filter((tag) => tag.type === TagType.KEYWORD)
			.map((tag) => tag.id),
		internalRevision: fields?.internalRevision,
		webPublicationDate:
			webPublicationDate &&
			new Date(webPublicationDate.dateTime.toNumber()).toISOString(),
	});

	if (!result.success) {
		console.warn('Skipping content with missing or invalid properties', {
			articleId: content.id,
			issues: result.error.issues,
		});
		return undefined;
	}
	return result.data;
}
