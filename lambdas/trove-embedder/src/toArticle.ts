import { ArticleV1 } from 'datastore/article';
import type { UpdateEmbeddingPayload } from 'shared/embeddingEvent';
import type { Embed } from './marengo.ts';

export const headlineAndStandfirst = (headline: string, standfirst: string) =>
	`${headline}\n${standfirst}`;

export const toArticleV1 = async (
	payload: UpdateEmbeddingPayload,
	embed: Embed,
	now: Date,
): Promise<ArticleV1> => {
	const embedText = async (value: string) => ({
		value,
		embeddings: { marengo_3_0: await embed(value) },
	});

	const [headline, standfirst, combined] = await Promise.all([
		embedText(payload.headline),
		embedText(payload.standfirst),
		embedText(headlineAndStandfirst(payload.headline, payload.standfirst)),
	]);

	return ArticleV1.parse({
		headline,
		standfirst,
		headlineAndStandfirst: combined,
		keywordTagIds: payload.keywordTagIds,
		internalRevision: payload.internalRevision,
		storedAt: now.toISOString(),
	});
};
