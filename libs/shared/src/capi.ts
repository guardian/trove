import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import type { SearchResponse } from '@guardian/content-api-models/v1/searchResponse.js';
import { SearchResponseSerde } from '@guardian/content-api-models/v1/searchResponse.js';
import { decodeThrift } from './thrift.ts';

const capiBaseUrl = 'https://content.guardianapis.com';

/** The params needed to build an embedding payload from CAPI content. */
const contentParams = (apiKey: string) => ({
	'api-key': apiKey,
	format: 'thrift',
	'show-fields': [
		'headline',
		'standfirst',
		'byline',
		'bodyText',
		'internalRevision',
		'wordcount',
		'firstPublicationDate',
	].join(','),
	'show-tags': 'keyword,tone',
});

/**
 * The backfill query. It must stay the same for a whole backfill run, as `/next` continues from the last seen item
 * using the same ordering. Newest first, so a partial run has already embedded the most recent content.
 */
const backfillParams = {
	'order-by': 'newest',
	type: 'article,liveblog',
	'page-size': '200',
};

/** Fetches a single item from CAPI, with the fields and tags needed to build an embedding payload. */
export async function fetchContent(
	capiUrl: string,
	apiKey: string,
): Promise<Content | undefined> {
	const url = new URL(capiUrl);
	// Crier's capiUrl asks for everything (blocks, elements...), which we don't need
	url.search = new URLSearchParams(contentParams(apiKey)).toString();

	const response = await fetch(url);
	// The content may have been taken down since the Crier event
	if (response.status === 404) {
		console.warn('CAPI returned 404, content not found', {
			capiUrl,
		});
		return undefined;
	}
	if (!response.ok) {
		throw new Error(
			`CAPI request for ${capiUrl} failed with status ${response.status}`,
		);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return decodeThrift(bytes, ItemResponseSerde).content;
}

/** Fetches the first page of the backfill query from CAPI `/search`. */
export async function searchBackfillContent(
	apiKey: string,
): Promise<SearchResponse> {
	const url = new URL('/search', capiBaseUrl);
	url.search = new URLSearchParams({
		...contentParams(apiKey),
		...backfillParams,
	}).toString();

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`CAPI request for ${url.pathname} failed with status ${response.status}`,
		);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return decodeThrift(bytes, SearchResponseSerde);
}
