import { z } from 'zod';

const BaseEmbeddingEvent = z.object({
	embeddingEventId: z.string(),
	source: z.enum(['listener', 'backfiller']),
});

export const UpdateEmbeddingPayload = z.object({
	articleId: z.string(),
	headline: z.string(),
	byline: z.string().optional(),
	articleType: z.enum(['article', 'liveblog']),
	sectionId: z.string(),
	pillarId: z.string(),
	standfirst: z.string().optional(),
	bodyTextPreview: z.string(),
	toneTagIds: z.array(z.string()),
	keywordTagIds: z.array(z.string()),
	internalRevision: z.number().int().nonnegative(),
	wordCount: z.number().int().nonnegative(),
	webPublicationDate: z.iso.datetime(),
	firstPublicationDate: z.iso.datetime(),
});
export type UpdateEmbeddingPayload = z.infer<typeof UpdateEmbeddingPayload>;

export const UpdateEmbeddingEvent = BaseEmbeddingEvent.extend({
	eventType: z.literal('update'),
	payload: UpdateEmbeddingPayload,
});
export type UpdateEmbeddingEvent = z.infer<typeof UpdateEmbeddingEvent>;

export const DeleteEmbeddingPayload = z.object({
	articleId: z.string(),
});
export type DeleteEmbeddingPayload = z.infer<typeof DeleteEmbeddingPayload>;

export const DeleteEmbeddingEvent = BaseEmbeddingEvent.extend({
	eventType: z.literal('delete'),
	payload: DeleteEmbeddingPayload,
});
export type DeleteEmbeddingEvent = z.infer<typeof DeleteEmbeddingEvent>;

export const EmbeddingEvent = z.discriminatedUnion('eventType', [
	UpdateEmbeddingEvent,
	DeleteEmbeddingEvent,
]);
export type EmbeddingEvent = z.infer<typeof EmbeddingEvent>;
