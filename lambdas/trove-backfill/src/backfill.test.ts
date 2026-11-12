import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EmbeddingEvent } from 'shared/src/embeddingEvent.ts';
import type { BackfillDeps } from './backfill.ts';
import { BackfillState, PAGE_SIZE, runBackfill } from './backfill.ts';
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
const fullPage = (page: number) =>
	Array.from({ length: PAGE_SIZE }, (_, i) => content(`${page}/${i}`));
const initialState = () =>
	BackfillState.parse({ fromDate: '2020-01-01', toDate: '2020-12-31' });

function fakeDeps(pages: CapiContent[][], depths: number[] = []) {
	const afterIds: Array<string | undefined> = [];
	const sent: EmbeddingEvent[] = [];
	const logs: Array<Record<string, unknown>> = [];
	const deps: BackfillDeps = {
		fetchPage: (afterId) => {
			afterIds.push(afterId);
			return Promise.resolve(pages.shift() ?? []);
		},
		send: (events) => {
			sent.push(...events);
			return Promise.resolve();
		},
		queueDepth: () => Promise.resolve(depths.shift() ?? 0),
		remainingTimeInMillis: () => 300_000,
		log: (entry) => logs.push(entry),
	};
	return { deps, afterIds, sent, logs };
}

void describe('runBackfill', () => {
	void it('limits each invocation to 2,000 articles and resumes with the same range and cursor', async () => {
		const { deps, afterIds, sent } = fakeDeps([
			...Array.from({ length: 10 }, (_, page) => fullPage(page)),
			[content('last')],
		]);
		const first = await runBackfill(initialState(), deps);
		assert.equal(first.complete, false);
		assert.equal(first.waiting, false);
		assert.equal(first.pages, 10);
		assert.equal(first.sent, 2000);
		assert.equal(afterIds.length, 10);
		assert.equal(first.lastSeenId, '9/199');
		assert.deepEqual(afterIds, [
			undefined,
			...Array.from({ length: 9 }, (_, page) => `${page}/199`),
		]);

		const second = await runBackfill(BackfillState.parse(first), deps);
		assert.equal(afterIds.at(-1), '9/199');
		assert.deepEqual(second, {
			...initialState(),
			pages: 11,
			sent: 2001,
			lastSeenId: 'last',
			lastSeenWebPublicationDate: '2020-01-01T00:00:00Z',
			complete: true,
			waiting: false,
		});
		assert.equal(sent.length, 2001);
	});

	void it('preserves progress while waiting for the queue, then resumes without skipping a page', async () => {
		const { deps, afterIds } = fakeDeps(
			[fullPage(0), [content('last')]],
			[9999, 10000, 20000, 0],
		);
		const first = await runBackfill(initialState(), deps);
		assert.equal(first.waiting, true);
		assert.equal(first.pages, 1);
		assert.equal(first.lastSeenId, '0/199');
		const second = await runBackfill(BackfillState.parse(first), deps);
		assert.deepEqual(second, first);
		assert.deepEqual(afterIds, [undefined]);
		const third = await runBackfill(BackfillState.parse(second), deps);
		assert.equal(third.complete, true);
		assert.equal(third.waiting, false);
		assert.deepEqual(afterIds, [undefined, '0/199']);
	});

	void it('skips invalid content but advances the cursor over it', async () => {
		const page = fullPage(0);
		page[199] = { ...content('invalid'), type: 'gallery' };
		const { deps, afterIds, sent, logs } = fakeDeps([page, []]);
		const result = await runBackfill(initialState(), deps);
		assert.equal(result.skipped, 1);
		assert.equal(result.sent, 199);
		assert.equal(result.complete, true);
		assert.deepEqual(afterIds, [undefined, 'invalid']);
		assert.ok(logs.some((entry) => entry.articleId === 'invalid'));
		assert.deepEqual(sent[0], {
			embeddingEventId: sent[0]?.embeddingEventId,
			source: 'backfiller',
			eventType: 'update',
			payload: {
				articleId: '0/0',
				byline: 'A Writer',
				articleType: 'article',
				headline: 'Headline 0/0',
				standfirst: 'Standfirst',
				keywordTagIds: ['world/world'],
				internalRevision: 7,
				webPublicationDate: '2020-01-01T00:00:00Z',
			},
		});
	});

	void it('yields before the Lambda timeout and keeps its cursor', async () => {
		const { deps, afterIds } = fakeDeps([fullPage(0)]);
		deps.remainingTimeInMillis = () => (afterIds.length ? 119_999 : 300_000);
		const result = await runBackfill(initialState(), deps);
		assert.equal(result.complete, false);
		assert.equal(result.waiting, false);
		assert.equal(result.lastSeenId, '0/199');
		assert.equal(result.pages, 1);
	});

	void it('completes an empty range without inventing a cursor', async () => {
		const { deps } = fakeDeps([[]]);
		const result = await runBackfill(initialState(), deps);
		assert.equal(result.complete, true);
		assert.equal(result.sent, 0);
		assert.equal(result.lastSeenId, undefined);
	});

	void it('propagates failures without mutating the input cursor or reporting completion', async () => {
		for (const dependency of ['fetchPage', 'send', 'queueDepth'] as const) {
			const { deps } = fakeDeps([[content('a')]]);
			deps[dependency] = (): Promise<never> =>
				Promise.reject(new Error('service failed'));
			const state = initialState();
			await assert.rejects(runBackfill(state, deps), /service failed/);
			assert.deepEqual(state, initialState());
		}
	});
});

void describe('BackfillState', () => {
	void it('rejects missing, invalid and reversed date bounds', () => {
		for (const input of [
			{},
			{ fromDate: '2020-02-30', toDate: '2020-12-31' },
			{ fromDate: '2021-01-01', toDate: '2020-12-31' },
		]) {
			assert.equal(BackfillState.safeParse(input).success, false);
		}
	});
});
