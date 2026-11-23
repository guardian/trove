import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { contentToPayload } from './contentToPayload.ts';
import { sampleContent } from './testing/fixtures.ts';

void describe('contentToPayload', () => {
	void it('maps an article, keeping keyword and tone tags', () => {
		assert.deepStrictEqual(contentToPayload(sampleContent), {
			articleId: 'world/2026/oct/30/example',
			headline: 'A headline',
			byline: 'A Reporter',
			articleType: 'article',
			sectionId: 'world',
			pillarId: 'news',
			standfirst: 'A standfirst',
			bodyTextPreview: 'The opening of the article body.',
			toneTagIds: ['tone/news'],
			keywordTagIds: ['world/world'],
			internalRevision: 42,
			wordCount: 6,
			webPublicationDate: '2026-10-30T10:00:00.000Z',
			firstPublicationDate: '2026-10-30T09:00:00.000Z',
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

	void it('omits a missing standfirst and byline', () => {
		const fields = {
			...sampleContent.fields,
			standfirst: undefined,
			byline: undefined,
		};
		const payload = contentToPayload({ ...sampleContent, fields });
		assert.equal(payload?.standfirst, undefined);
		assert.equal(payload?.byline, undefined);
	});

	void it('limits the body text preview to 500 characters', () => {
		const fields = {
			...sampleContent.fields,
			bodyText: 'a'.repeat(501),
		};
		const payload = contentToPayload({ ...sampleContent, fields });
		assert.equal(payload?.bodyTextPreview.length, 500);
	});

	void it('warns and skips content missing a required property', (t) => {
		const warn = t.mock.method(console, 'warn', () => undefined);
		const fields = { ...sampleContent.fields, headline: undefined };
		assert.equal(contentToPayload({ ...sampleContent, fields }), undefined);
		assert.equal(warn.mock.callCount(), 1);
	});
});
