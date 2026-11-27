import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ItemResponseSerde } from '@guardian/content-api-models/v1/itemResponse.js';
import { decodeThrift } from './thrift.ts';

const fields = [
	'headline',
	'standfirst',
	'byline',
	'bodyText',
	'internalRevision',
	'wordcount',
	'firstPublicationDate',
].join(',');

/** Fetches a single item from CAPI, with the fields and tags needed to build an embedding payload. */
export async function fetchContent(
	capiUrl: string,
	apiKey: string,
): Promise<Content | undefined> {
	const url = new URL(capiUrl);
	// Crier's capiUrl asks for everything (blocks, elements...), which we don't need
	url.search = new URLSearchParams({
		'api-key': apiKey,
		format: 'thrift',
		'show-fields': fields,
		'show-tags': 'keyword,tone',
	}).toString();

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
