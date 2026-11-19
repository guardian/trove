import type { Content } from '@guardian/content-api-models/v1/content.js';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import type { Tag } from '@guardian/content-api-models/v1/tag.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import { Int64 } from 'thrift';

const tag = (id: string, type: TagType): Tag => ({
	id,
	type,
	webTitle: id,
	webUrl: `https://www.theguardian.com/${id}`,
	apiUrl: `https://content.guardianapis.com/${id}`,
	references: [],
});

/** A minimal CAPI article, for tests. */
export const sampleContent: Content = {
	id: 'world/2026/oct/30/example',
	type: ContentType.ARTICLE,
	webTitle: 'A headline',
	webUrl: 'https://www.theguardian.com/world/2026/oct/30/example',
	apiUrl: 'https://content.guardianapis.com/world/2026/oct/30/example',
	webPublicationDate: {
		dateTime: new Int64(Date.parse('2026-10-30T10:00:00Z')),
		iso8601: '2026-10-30T10:00:00Z',
	},
	fields: {
		headline: 'A headline',
		standfirst: 'A standfirst',
		byline: 'A Reporter',
		internalRevision: 42,
	},
	tags: [
		tag('world/world', TagType.KEYWORD),
		tag('profile/a-reporter', TagType.CONTRIBUTOR),
	],
	references: [],
	isHosted: false,
};
