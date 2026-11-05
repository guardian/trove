import type { Client } from '@opensearch-project/opensearch';
import { articleV1Mapping } from './article.ts';

export const articleIndices = {
	v1: { name: 'articles-v1', mapping: articleV1Mapping },
};
type ArticleVersion = keyof typeof articleIndices;

/** Readers use `current`. Writers write to both, so `next` can be backfilled while `current` serves traffic. */
export const articleAliases = {
	current: 'articles-current',
	next: 'articles-next',
};
type AliasRole = keyof typeof articleAliases;

// To migrate: point `next` to the new version, run init-schema and backfill, then move `current`
export const aliasTargets: Record<AliasRole, ArticleVersion> = {
	current: 'v1',
	next: 'v1',
};

/** The concrete indices behind `current` and `next`, deduplicated so each document is written once per index. */
export const resolveWriteIndices = async (
	client: Client,
): Promise<string[]> => {
	const { body } = await client.indices.getAlias({
		name: Object.values(articleAliases),
	});
	return Object.keys(body);
};
