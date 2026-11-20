import assert from 'node:assert/strict';
import { after, describe, it, mock } from 'node:test';
import type { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import type { EmbeddingEvent } from 'shared/embeddingEvent';
import { handler } from './index.ts';

// Fails any request whose text contains "fail", otherwise returns a valid embedding
mock.method(
	BedrockRuntimeClient.prototype,
	'send',
	(command: InvokeModelCommand) => {
		const body = command.input.body as string;
		if (body.includes('fail')) {
			return Promise.reject(new Error('Bedrock error'));
		}
		const embedding = Array.from({ length: 512 }, () => 0.5);
		return Promise.resolve({
			body: new TextEncoder().encode(JSON.stringify({ data: [{ embedding }] })),
		});
	},
);
after(() => mock.restoreAll());

const record = (messageId: string, body: unknown): SQSRecord =>
	({
		messageId,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	}) as SQSRecord;

const update = (
	headline: string,
	standfirst: string | undefined,
): EmbeddingEvent => ({
	embeddingEventId: 'event-update',
	source: 'listener',
	eventType: 'update',
	payload: {
		articleId: 'world/2026/oct/26/example',
		byline: 'A Reporter',
		articleType: 'article',
		headline,
		sectionId: 'world',
		pillarId: 'news',
		standfirst,
		bodyTextPreview: 'The opening of the article body.',
		toneTagIds: ['tone/news'],
		keywordTagIds: [],
		internalRevision: 1,
		wordCount: 8,
		webPublicationDate: '2026-10-26T10:00:00Z',
		firstPublicationDate: '2026-10-26T09:00:00Z',
	},
});

const remove: EmbeddingEvent = {
	embeddingEventId: 'event-delete',
	source: 'backfiller',
	eventType: 'delete',
	payload: { articleId: 'gone' },
};

void describe('handler', () => {
	void it('reports only the messages that failed', async () => {
		const event: SQSEvent = {
			Records: [
				record('update', update('A headline', 'A standfirst')),
				record('update-without-standfirst', update('A headline', undefined)),
				record('delete', remove),
				record('bad-json', '{not json'),
				record('bad-schema', { eventType: 'update', payload: {} }),
				record('embed-fails', update('this will fail', 'A standfirst')),
			],
		};

		assert.deepEqual(await handler(event), {
			batchItemFailures: [
				{ itemIdentifier: 'bad-json' },
				{ itemIdentifier: 'bad-schema' },
				{ itemIdentifier: 'embed-fails' },
			],
		});
	});
});
