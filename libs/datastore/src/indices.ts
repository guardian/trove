import { articleV1Mapping } from './article.ts';

/** Every declared version gets an index, created by apply-schema. */
export const articleIndices = {
	v1: { name: 'articles-v1', mapping: articleV1Mapping },
};
