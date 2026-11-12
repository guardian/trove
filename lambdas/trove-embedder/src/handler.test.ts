import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { EmbeddingEvent } from 'shared/embeddingEvent';
import { createHandler } from './handler.ts';

const record = (messageId: string, body: unknown): SQSRecord =>
	({
		messageId,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	}) as SQSRecord;

const sqsEvent = (...records: SQSRecord[]): SQSEvent => ({ Records: records });

const update = (
	articleId: string,
	headline = 'A headline',
): EmbeddingEvent => ({
	embeddingEventId: `event-${articleId}`,
	source: 'listener',
	eventType: 'update',
	payload: {
		articleId,
		byline: 'A Reporter',
		articleType: 'article',
		headline,
		standfirst: 'A standfirst',
		keywordTagIds: [],
		internalRevision: 1,
		webPublicationDate: '2026-10-26T10:00:00Z',
	},
});

const remove: EmbeddingEvent = {
	embeddingEventId: 'event-delete',
	source: 'backfiller',
	eventType: 'delete',
	payload: { articleId: 'gone' },
};

const embedded: string[] = [];
const handler = createHandler({
	embed: (text) => {
		embedded.push(text);
		return text.includes('fail')
			? Promise.reject(new Error('Bedrock error'))
			: Promise.resolve(Array.from({ length: 512 }, () => 0.5));
	},
});

void describe('handler', () => {
	void it('reports no failures when every message is processed', async () => {
		embedded.length = 0;
		const response = await handler(
			sqsEvent(record('1', update('a')), record('2', remove)),
		);

		assert.deepEqual(response, { batchItemFailures: [] });
		// The delete event is skipped, so only the update's three texts are embedded
		assert.equal(embedded.length, 3);
	});

	void it('reports only the messages that failed', async () => {
		const response = await handler(
			sqsEvent(
				record('ok', update('a')),
				record('bad-json', '{not json'),
				record('bad-schema', { eventType: 'update', payload: {} }),
				record('embed-fails', update('b', 'this will fail')),
			),
		);

		assert.deepEqual(response, {
			batchItemFailures: [
				{ itemIdentifier: 'bad-json' },
				{ itemIdentifier: 'bad-schema' },
				{ itemIdentifier: 'embed-fails' },
			],
		});
	});
});
