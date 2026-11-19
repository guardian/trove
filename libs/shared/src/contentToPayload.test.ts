import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { contentToPayload } from './contentToPayload.ts';
import { sampleContent } from './testing/fixtures.ts';

void describe('contentToPayload', () => {
	void it('maps an article, keeping only keyword tags', () => {
		assert.deepStrictEqual(contentToPayload(sampleContent), {
			articleId: 'world/2026/oct/30/example',
			byline: 'A Reporter',
			articleType: 'article',
			headline: 'A headline',
			standfirst: 'A standfirst',
			keywordTagIds: ['world/world'],
			internalRevision: 42,
			webPublicationDate: '2026-10-30T10:00:00.000Z',
		});
	});

	void it('maps a liveblog', () => {
		const payload = contentToPayload({
			...sampleContent,
			type: ContentType.LIVEBLOG,
		});
		assert.equal(payload?.articleType, 'liveblog');
	});

	void it('ignores other content types without warning', (t) => {
		const warn = t.mock.method(console, 'warn', () => undefined);
		assert.equal(
			contentToPayload({ ...sampleContent, type: ContentType.GALLERY }),
			undefined,
		);
		assert.equal(warn.mock.callCount(), 0);
	});

	void it('defaults a missing standfirst and byline to empty strings', () => {
		const fields = {
			...sampleContent.fields,
			standfirst: undefined,
			byline: undefined,
		};
		const payload = contentToPayload({ ...sampleContent, fields });
		assert.equal(payload?.standfirst, '');
		assert.equal(payload.byline, '');
	});

	void it('warns and skips content missing a required property', (t) => {
		const warn = t.mock.method(console, 'warn', () => undefined);
		const fields = { ...sampleContent.fields, headline: undefined };
		assert.equal(contentToPayload({ ...sampleContent, fields }), undefined);
		assert.equal(warn.mock.callCount(), 1);
	});
});
