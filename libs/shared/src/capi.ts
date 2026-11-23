import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import { decodeThrift } from './thrift.ts';

/** Fetches a single item from CAPI, with the fields and tags needed to build an embedding payload. */
export async function fetchContent(
	capiUrl: string,
	apiKey: string,
): Promise<Content | undefined> {
	const url = new URL(capiUrl);
	url.searchParams.set('api-key', apiKey);
	url.searchParams.set('format', 'thrift');
	url.searchParams.set(
		'show-fields',
		'headline,standfirst,byline,bodyText,internalRevision,wordcount,firstPublicationDate',
	);
	url.searchParams.set('show-tags', 'keyword,tone');

	const response = await fetch(url, {
		headers: { Accept: 'application/x-thrift' },
	});
	if (!response.ok) {
		throw new Error(
			`CAPI request for ${capiUrl} failed with status ${response.status}`,
		);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	return decodeThrift(bytes, ItemResponseSerde).content;
}
