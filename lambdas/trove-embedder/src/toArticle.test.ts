import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UpdateEmbeddingPayload } from 'shared/embeddingEvent';
import { toArticleV1 } from './toArticle.ts';

const payload: UpdateEmbeddingPayload = {
	articleId: 'world/2026/oct/26/lula-wins-brazil-election',
	byline: 'A Reporter',
	articleType: 'article',
	headline: 'Lula wins Brazil election',
	standfirst: 'Incumbent secures another term after a tight run-off',
	keywordTagIds: ['world/brazil'],
	internalRevision: 42,
	webPublicationDate: '2026-10-26T10:00:00Z',
};

/** Encodes the text's length into the vector so we can tell which text each one came from. */
const fakeEmbed = (text: string) =>
	Promise.resolve(Array.from({ length: 512 }, () => text.length));

const now = new Date('2026-11-12T16:00:00.000Z');

void describe('toArticleV1', () => {
	void it('embeds the headline, standfirst and their combination', async () => {
		const article = await toArticleV1(payload, fakeEmbed, now);

		const combined = `${payload.headline}\n${payload.standfirst}`;
		assert.equal(article.headline.value, payload.headline);
		assert.equal(article.standfirst.value, payload.standfirst);
		assert.equal(article.headlineAndStandfirst.value, combined);
		assert.equal(
			article.headline.embeddings.marengo_3_0[0],
			payload.headline.length,
		);
		assert.equal(
			article.standfirst.embeddings.marengo_3_0[0],
			payload.standfirst.length,
		);
		assert.equal(
			article.headlineAndStandfirst.embeddings.marengo_3_0[0],
			combined.length,
		);
	});

	void it('copies the metadata and stamps storedAt', async () => {
		const article = await toArticleV1(payload, fakeEmbed, now);

		assert.deepEqual(article.keywordTagIds, payload.keywordTagIds);
		assert.equal(article.internalRevision, payload.internalRevision);
		assert.equal(article.storedAt, '2026-11-12T16:00:00.000Z');
	});

	void it('rejects embeddings that do not match the index dimension', async () => {
		await assert.rejects(
			toArticleV1(payload, () => Promise.resolve([0.1]), now),
		);
	});
});
