import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Page, PaginateOptions } from './capi.ts';
import { paginateCapi } from './capi.ts';

const page = (ids: string[], total = 99) =>
	Response.json({
		response: { total, results: ids.map((id) => ({ id })) },
	});

const fakeFetch = (responses: Array<Response | Error>) => {
	const urls: string[] = [];
	// paginateCapi always passes a string URL
	const fetch = (url: string) => {
		urls.push(url);
		const next = responses.shift();
		if (!next) {
			throw new Error('Unexpected request');
		}
		return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
	};
	return { fetch: fetch as typeof globalThis.fetch, urls };
};

const collect = async (options: PaginateOptions) => {
	const pages: Page[] = [];
	for await (const p of paginateCapi(options)) {
		pages.push(p);
	}
	return pages;
};

const baseOptions = {
	baseUrl: 'https://capi.test',
	apiKey: 'secret',
	params: { type: 'article' },
	pageSize: 2,
	sleep: () => Promise.resolve(),
};

void describe('paginateCapi', () => {
	void it('starts with /search then follows /next until a short page', async () => {
		const { fetch, urls } = fakeFetch([
			page(['a', 'b']),
			page(['c', 'd']),
			page(['e']),
		]);

		const pages = await collect({ ...baseOptions, fetch });

		assert.deepEqual(
			pages.map((p) => p.results.map((r) => r.id)),
			[['a', 'b'], ['c', 'd'], ['e']],
		);
		const paths = urls.map((u) => new URL(u).pathname);
		assert.deepEqual(paths, ['/search', '/content/b/next', '/content/d/next']);
		const query = new URL(urls[0] ?? '').searchParams;
		assert.equal(query.get('order-by'), 'oldest');
		assert.equal(query.get('page-size'), '2');
		assert.equal(query.get('type'), 'article');
		assert.ok(pages.every((p) => p.url.includes('api-key=***')));
	});

	void it('stops on an empty page when the total is a multiple of the page size', async () => {
		const { fetch, urls } = fakeFetch([page(['a', 'b']), page([])]);

		const pages = await collect({ ...baseOptions, fetch });

		assert.equal(pages.length, 2);
		assert.equal(urls.length, 2);
	});

	void it('resumes from startAfterId using /next', async () => {
		const { fetch, urls } = fakeFetch([page(['x'])]);

		await collect({ ...baseOptions, fetch, startAfterId: 'world/2020/x' });

		assert.equal(new URL(urls[0] ?? '').pathname, '/content/world/2020/x/next');
	});

	void it('retries network errors, 429s and 5xxs', async () => {
		const { fetch } = fakeFetch([
			new TypeError('fetch failed'),
			new Response(null, { status: 429 }),
			new Response(null, { status: 503 }),
			page(['a']),
		]);

		const pages = await collect({ ...baseOptions, fetch });

		assert.deepEqual(pages[0]?.results, [{ id: 'a' }]);
	});

	void it('gives up after maxAttempts', async () => {
		const { fetch } = fakeFetch([
			new Response(null, { status: 500 }),
			new Response(null, { status: 500 }),
		]);

		await assert.rejects(collect({ ...baseOptions, fetch, maxAttempts: 2 }), {
			message: /after 2 attempts: HTTP 500/,
		});
	});

	void it('fails immediately on non-retryable errors, without leaking the key', async () => {
		const { fetch, urls } = fakeFetch([new Response(null, { status: 403 })]);

		await assert.rejects(collect({ ...baseOptions, fetch }), (error: Error) => {
			assert.match(error.message, /HTTP 403/);
			assert.doesNotMatch(error.message, /secret/);
			return true;
		});
		assert.equal(urls.length, 1);
	});
});
