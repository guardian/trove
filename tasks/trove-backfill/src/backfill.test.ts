import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BackfillDeps } from './backfill.ts';
import { runBackfill } from './backfill.ts';
import type { CapiContent } from './capi.ts';

const content = (id: string): CapiContent => ({
	id,
	type: 'article',
	webPublicationDate: '2020-01-01T00:00:00Z',
	fields: {
		headline: `Headline ${id}`,
		standfirst: 'Standfirst',
		byline: 'A Writer',
		internalRevision: '7',
	},
	tags: [
		{ id: 'world/world', type: 'keyword' },
		{ id: 'profile/a-writer', type: 'contributor' },
	],
});

function fakeDeps(pages: CapiContent[][], depths: number[] = []) {
	const calls = { afterIds: [] as Array<string | undefined>, sleeps: 0 };
	const sent: unknown[] = [];
	const deps: BackfillDeps = {
		fetchPage: (afterId) => {
			calls.afterIds.push(afterId);
			return Promise.resolve(pages.shift() ?? []);
		},
		send: (events) => {
			sent.push(...events);
			return Promise.resolve();
		},
		queueDepth: () => Promise.resolve(depths.shift() ?? 0),
		sleep: () => {
			calls.sleeps++;
			return Promise.resolve();
		},
		log: () => {},
	};
	return { deps, calls, sent };
}

const options = {
	pageSize: 2,
	maxQueueDepth: 100,
	backoffMs: 0,
	signal: new AbortController().signal,
};

void describe('runBackfill', () => {
	void it('pages using the last seen id until a short page, skipping invalid content', async () => {
		const invalid = { ...content('c'), type: 'gallery' };
		const { deps, calls, sent } = fakeDeps([
			[content('a'), content('b')],
			[invalid, content('d')],
			[content('e')],
		]);

		const result = await runBackfill(deps, options);

		assert.deepEqual(calls.afterIds, [undefined, 'b', 'd']);
		assert.equal(sent.length, 4);
		assert.deepEqual(sent[0], {
			embeddingEventId: (sent[0] as { embeddingEventId: string })
				.embeddingEventId,
			source: 'backfiller',
			eventType: 'update',
			payload: {
				articleId: 'a',
				byline: 'A Writer',
				articleType: 'article',
				headline: 'Headline a',
				standfirst: 'Standfirst',
				keywordTagIds: ['world/world'],
				internalRevision: 7,
				webPublicationDate: '2020-01-01T00:00:00Z',
			},
		});
		assert.deepEqual(result, {
			complete: true,
			pages: 3,
			sent: 4,
			skipped: 1,
			lastSeenId: 'e',
			lastSeenWebPublicationDate: '2020-01-01T00:00:00Z',
		});
	});

	void it('waits while the queue is over the max depth', async () => {
		const { deps, calls } = fakeDeps([[content('a')]], [500, 100, 99]);

		await runBackfill(deps, options);

		assert.equal(calls.sleeps, 2);
		assert.equal(calls.afterIds.length, 1);
	});

	void it('stops without completing when aborted', async () => {
		const controller = new AbortController();
		const { deps, calls } = fakeDeps([
			[content('a'), content('b')],
			[content('c'), content('d')],
		]);
		const send = deps.send;
		deps.send = (events) => {
			controller.abort();
			return send(events);
		};

		const result = await runBackfill(deps, {
			...options,
			signal: controller.signal,
		});

		assert.equal(result.complete, false);
		assert.equal(result.lastSeenId, 'b');
		assert.equal(calls.afterIds.length, 1);
	});
});
