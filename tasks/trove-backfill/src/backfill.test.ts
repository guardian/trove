import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchResponse } from '@guardian/content-api-models/v1/searchResponse.js';
import type { UpdateEmbeddingEvent } from 'shared/embeddingEvent';
import { sampleContent } from 'shared/testing/fixtures';
import { backfillFirstPage } from './backfill.ts';

const searchResponse = (
	results: SearchResponse['results'],
): SearchResponse => ({
	status: 'ok',
	userTier: 'internal',
	total: results.length,
	startIndex: 1,
	pageSize: 200,
	currentPage: 1,
	pages: 1,
	orderBy: 'newest',
	results,
});

void describe('backfillFirstPage', () => {
	void it('sends backfiller update events for content we embed, skipping the rest', async () => {
		const withoutHeadline = {
			...sampleContent,
			id: 'world/2026/oct/30/no-headline',
			fields: { ...sampleContent.fields, headline: undefined },
		};
		const sent: UpdateEmbeddingEvent[] = [];

		await backfillFirstPage(
			() => Promise.resolve(searchResponse([sampleContent, withoutHeadline])),
			(events) => {
				sent.push(...events);
				return Promise.resolve();
			},
		);

		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.source, 'backfiller');
		assert.equal(sent[0].eventType, 'update');
		assert.equal(sent[0].payload.articleId, sampleContent.id);
	});

	void it("doesn't send anything when no content can be embedded", async () => {
		let sendCalls = 0;

		await backfillFirstPage(
			() => Promise.resolve(searchResponse([])),
			() => {
				sendCalls++;
				return Promise.resolve();
			},
		);

		assert.equal(sendCalls, 0);
	});
});
