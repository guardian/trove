import type { CapiDateTime } from '@guardian/content-api-models/v1/capiDateTime.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import { z } from 'zod';
import { UpdateEmbeddingPayload } from './embeddingEvent.ts';

const articleTypes = {
	[ContentType.ARTICLE]: 'article',
	[ContentType.LIVEBLOG]: 'liveblog',
} as const;

function toIsoDate(value: CapiDateTime | undefined): string | undefined {
	return value && new Date(value.dateTime.toNumber()).toISOString();
}

// Marengo rejects empty text, and CAPI sends "" for fields that were cleared
function nonBlank(value: string | undefined): string | undefined {
	return value?.trim() ? value : undefined;
}

const maxPreviewWords = 300;

export function bodyTextPreview(text: string): string {
	const words = [...text.matchAll(/\S+/g)];
	if (words.length <= maxPreviewWords) {
		return text;
	}
	const lastWord = words[maxPreviewWords - 1]!;
	const wordLimit = lastWord.index + lastWord[0].length;
	const limited = text.slice(0, wordLimit);
	const sentenceEnds = [...limited.matchAll(/[.!?]["')\]]*(?=\s|$)/g)];
	const lastSentenceEnd = sentenceEnds.at(-1);
	if (!lastSentenceEnd) {
		return limited;
	}
	return limited.slice(0, lastSentenceEnd.index + lastSentenceEnd[0].length);
}

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
	const bodyText = nonBlank(fields?.bodyText);
	const result = UpdateEmbeddingPayload.safeParse({
		articleId: content.id,
		headline: nonBlank(fields?.headline),
		byline: nonBlank(fields?.byline),
		articleType: articleTypes[content.type],
		sectionId: content.sectionId,
		pillarId: content.pillarId,
		standfirst: nonBlank(fields?.standfirst),
		bodyTextPreview: bodyText && bodyTextPreview(bodyText),
		toneTagIds: content.tags
			.filter((tag) => tag.type === TagType.TONE)
			.map((tag) => tag.id),
		keywordTagIds: content.tags
			.filter((tag) => tag.type === TagType.KEYWORD)
			.map((tag) => tag.id),
		internalRevision: fields?.internalRevision,
		wordCount: fields?.wordcount,
		webPublicationDate: toIsoDate(webPublicationDate),
		firstPublicationDate: toIsoDate(fields?.firstPublicationDate),
	});

	if (!result.success) {
		console.warn(
			`Skipping ${content.id} with missing or invalid properties:\n${z.prettifyError(result.error)}`,
		);
		return undefined;
	}
	return result.data;
}
