import { z } from 'zod';
import { openSearchProperty, toMapping } from './mapping.ts';
import { embeddingModels, knnVector } from './open-search-embeddings.ts';

const embeddedText = z.object({
	value: z
		.string()
		.register(openSearchProperty, { type: 'text', analyzer: 'english' }),
	embeddings: z.object({
		marengo_3_0: knnVector(embeddingModels.marengo_3_0),
	}),
});

/** The document `_source`. The CAPI id is the document `_id`, so isn't part of it. */
export const ArticleV1 = z.object({
	headline: embeddedText,
	standfirst: embeddedText,
	headlineAndStandfirst: embeddedText,
	keywordTagIds: z.array(
		z.string().register(openSearchProperty, { type: 'keyword' }),
	),
	internalRevision: z
		.number()
		.int()
		.register(openSearchProperty, { type: 'long' }),
	storedAt: z.iso.datetime(),
});
export type ArticleV1 = z.infer<typeof ArticleV1>;

export const articleV1Mapping = toMapping(ArticleV1);
