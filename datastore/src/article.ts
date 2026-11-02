import { z } from 'zod';
import { os, toMapping } from './mapping.ts';

export const ARTICLES_INDEX = 'articles';

// Keys are short aliases because OpenSearch treats dots in field names as object paths
export const embeddingModels = {
	marengo_3_0: { modelId: 'twelvelabs.marengo-embed-3-0-v1:0', dimension: 512 },
} as const;

const vector = ({ dimension }: { dimension: number }) =>
	z
		.array(z.number())
		.length(dimension)
		.register(os, {
			type: 'knn_vector',
			dimension,
			method: { name: 'hnsw', engine: 'faiss', space_type: 'cosinesimil' },
		});

const embeddedText = z.object({
	value: z.string().register(os, { type: 'text', analyzer: 'english' }),
	embeddings: z.object({
		marengo_3_0: vector(embeddingModels.marengo_3_0),
	}),
});

/** The document `_source`. The CAPI id is the document `_id`, so isn't part of it. */
export const Article = z.object({
	headline: embeddedText,
	standfirst: embeddedText,
	headlineAndStandfirst: embeddedText,
	keywordTagIds: z.array(z.string()),
	internalRevision: z.number().int().register(os, { type: 'long' }),
	storedAt: z.iso.datetime().register(os, { type: 'date' }),
});
export type Article = z.infer<typeof Article>;

export const articleMapping = toMapping(Article);
