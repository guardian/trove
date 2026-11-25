import { articleV1Mapping } from './article.ts';

/** Every declared version gets an index, created by apply-schema. The embedder only writes to v1 for now. */
export const articleIndices = {
	v1: { name: 'articles-v1', mapping: articleV1Mapping },
};
