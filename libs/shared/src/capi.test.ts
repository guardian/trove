import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import { fetchContent } from './capi.ts';
import { sampleContent } from './testing/fixtures.ts';
import { encodeThrift } from './thrift.ts';

void describe('fetchContent', () => {
	void it('requests thrift and decodes the item response', async (t) => {
		const body = encodeThrift(
			{ status: 'ok', userTier: 'internal', content: sampleContent },
			ItemResponseSerde,
		);
		const fetchMock = t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response(body)),
		);

		const content = await fetchContent(sampleContent.apiUrl, 'my-key');

		assert.equal(content?.id, sampleContent.id);
		assert.equal(content.fields?.internalRevision, 42);
		const url = fetchMock.mock.calls[0]?.arguments[0] as URL;
		assert.equal(url.searchParams.get('format'), 'thrift');
		assert.equal(url.searchParams.get('api-key'), 'my-key');
		assert.equal(
			url.searchParams.get('show-fields'),
			'headline,standfirst,byline,bodyText,internalRevision,wordcount,firstPublicationDate',
		);
		assert.equal(url.searchParams.get('show-tags'), 'keyword,tone');
	});

	void it('throws on a non-2xx response', async (t) => {
		t.mock.method(globalThis, 'fetch', () =>
			Promise.resolve(new Response('nope', { status: 500 })),
		);
		await assert.rejects(fetchContent(sampleContent.apiUrl, 'my-key'), /500/);
	});
});
