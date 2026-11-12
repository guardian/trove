import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createCapiPageFetcher } from './capi.ts';

void it('uses search then the content cursor with identical date bounds and fields', async (context) => {
	const urls: URL[] = [];
	context.mock.method(globalThis, 'fetch', (url: string) => {
		urls.push(new URL(url));
		return Promise.resolve(Response.json({ response: { results: [] } }));
	});
	const fetchPage = createCapiPageFetcher({
		baseUrl: 'https://content.guardianapis.com',
		apiKey: 'test-key',
		pageSize: 200,
		fromDate: '2020-01-01',
		toDate: '2020-12-31',
	});
	await fetchPage(undefined);
	await fetchPage('world/2020/jan/01/example');
	assert.equal(urls[0]?.pathname, '/search');
	assert.equal(urls[1]?.pathname, '/content/world/2020/jan/01/example/next');
	for (const url of urls) {
		assert.deepEqual(Object.fromEntries(url.searchParams), {
			type: 'article,liveblog',
			'order-by': 'oldest',
			'use-date': 'published',
			'page-size': '200',
			'show-fields': 'headline,standfirst,byline,internalRevision',
			'show-tags': 'keyword',
			'api-key': 'test-key',
			'from-date': '2020-01-01',
			'to-date': '2020-12-31',
		});
	}
});
