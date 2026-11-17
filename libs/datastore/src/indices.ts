import { ArticleV1, articleV1Mapping } from './article.ts';

/** Every declared version gets an index, created by apply-schema, and is written to by the embedder. */
export const articleIndices = {
	v1: { name: 'articles-v1', mapping: articleV1Mapping, schema: ArticleV1 },
};
