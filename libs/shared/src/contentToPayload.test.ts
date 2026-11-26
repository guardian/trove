import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentType } from '@guardian/content-api-models/v1/contentType.js';
import { bodyTextPreview, contentToPayload } from './contentToPayload.ts';
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

	void it('ignores other content types without warning', (t) => {
		const warn = t.mock.method(console, 'warn', () => undefined);
		assert.equal(
			contentToPayload({ ...sampleContent, type: ContentType.GALLERY }),
			undefined,
		);
		assert.equal(warn.mock.callCount(), 0);
	});

	void it('limits the body text preview to a sentence within 300 words', () => {
		assert.equal(
			bodyTextPreview(`A sentence ends here. ${'word '.repeat(300)}`),
			'A sentence ends here.',
		);
	});

	void it('keeps text that is no more than 300 words', () => {
		const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
		assert.equal(bodyTextPreview(text), text);
	});

	void it('falls back to 300 words when there is no sentence boundary', () => {
		const words = Array.from({ length: 301 }, (_, i) => `word${i}`);
		assert.equal(
			bodyTextPreview(words.join(' ')),
			words.slice(0, 300).join(' '),
		);
	});

	void it('warns and skips content missing a required property', (t) => {
		const warn = t.mock.method(console, 'warn', () => undefined);
		const fields = { ...sampleContent.fields, headline: undefined };
		assert.equal(contentToPayload({ ...sampleContent, fields }), undefined);
		assert.equal(warn.mock.callCount(), 1);
		assert.match(String(warn.mock.calls[0]?.arguments[0]), /headline/);
	});
});
