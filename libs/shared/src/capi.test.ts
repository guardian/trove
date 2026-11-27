import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import { SearchResponseSerde } from '@guardian/content-api-models/v1/searchResponse.js';
import { fetchContent, searchBackfillContent } from './capi.ts';
import { sampleContent } from './testing/fixtures.ts';
import { encodeThrift } from './testing/thrift.ts';

void describe('fetchContent', () => {
	void it('requests thrift and decodes the item response', async (t) => {
		const body = encodeThrift(
			{ status: 'ok', userTier: 'internal', content: sampleContent },
			ItemResponseSerde,
		);
		const fetchMock = t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response(body)),
		);

		const content = await fetchContent(
			`${sampleContent.apiUrl}?show-blocks=all`,
			'my-key',
		);

		assert.equal(content?.id, sampleContent.id);
		const url = fetchMock.mock.calls[0]?.arguments[0] as URL;
		assert.equal(url.searchParams.get('format'), 'thrift');
		assert.equal(url.searchParams.get('api-key'), 'my-key');
		assert.equal(url.searchParams.has('show-blocks'), false);
	});

	void it('returns undefined for content that no longer exists', async (t) => {
		t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response('gone', { status: 404 })),
		);
		assert.equal(await fetchContent(sampleContent.apiUrl, 'my-key'), undefined);
	});

	void it('throws on a non-2xx response', async (t) => {
		t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response('nope', { status: 500 })),
		);
		await assert.rejects(fetchContent(sampleContent.apiUrl, 'my-key'), /500/);
	});
});

void describe('searchBackfillContent', () => {
	void it('requests the backfill query from /search', async (t) => {
		const body = encodeThrift(
			{
				status: 'ok',
				userTier: 'internal',
				total: 1,
				startIndex: 1,
				pageSize: 200,
				currentPage: 1,
				pages: 1,
				orderBy: 'newest',
				results: [sampleContent],
			},
			SearchResponseSerde,
		);
		const fetchMock = t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response(body)),
		);

		await searchBackfillContent('my-key');

		const url = fetchMock.mock.calls[0]?.arguments[0] as URL;
		assert.equal(url.pathname, '/search');
		assert.equal(url.searchParams.get('api-key'), 'my-key');
		assert.equal(url.searchParams.get('format'), 'thrift');
		assert.equal(url.searchParams.get('order-by'), 'newest');
		assert.equal(url.searchParams.get('type'), 'article|liveblog');
		assert.equal(url.searchParams.get('page-size'), '200');
		assert.equal(url.searchParams.get('show-tags'), 'keyword,tone');
	});

	void it('throws on a non-2xx response', async (t) => {
		t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response('nope', { status: 500 })),
		);
		await assert.rejects(searchBackfillContent('my-key'), /500/);
	});
});
