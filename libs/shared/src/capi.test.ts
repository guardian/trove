import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import { fetchContent } from './capi.ts';
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
