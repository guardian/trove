import assert from 'node:assert/strict';
import { after, beforeEach, describe, it, mock } from 'node:test';
import type { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { errors, Transport } from '@opensearch-project/opensearch';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { articleIndices } from 'datastore/indices';
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

type OpenSearchRequest = {
	method: string;
	path: string;
	querystring: Record<string, unknown>;
	body?: { headline: { value: string } };
};

// Writes: stale headlines are a version conflict, "os-error" ones a server error.
// Deletes: ids containing "missing" are not found, "os-error" ones a server error.
const opensearch = mock.method(
	Transport.prototype,
	'request',
	({ method, path, body }: OpenSearchRequest) => {
		const subject = method === 'DELETE' ? path : (body?.headline.value ?? '');
		const statusCode = subject.includes('stale')
			? 409
			: subject.includes('missing')
				? 404
				: subject.includes('os-error')
					? 500
					: 200;
		const response = {
			body: statusCode === 500 ? { error: 'os-error reason' } : {},
			statusCode,
			headers: {},
			warnings: null,
			meta: {} as never,
		};
		return statusCode === 200
			? Promise.resolve(response)
			: Promise.reject(new errors.ResponseError(response));
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
	standfirst: string | undefined = 'A standfirst',
	bodyTextPreview = 'The opening of the article body.',
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
		bodyTextPreview,
		toneTagIds: ['tone/news'],
		keywordTagIds: [],
		internalRevision: 1,
		wordCount: 8,
		webPublicationDate: '2026-10-26T10:00:00Z',
		firstPublicationDate: '2026-10-26T09:00:00Z',
	},
});

const remove = (articleId: string): EmbeddingEvent => ({
	embeddingEventId: 'event-delete',
	source: 'backfiller',
	eventType: 'delete',
	payload: { articleId },
});

void describe('handler', () => {
	beforeEach(() => opensearch.mock.resetCalls());

	void it('writes to the v1 index, versioned by the internal revision', async () => {
		await handler({ Records: [record('update', update('A headline'))] });

		assert.deepEqual(
			opensearch.mock.calls.map(
				({ arguments: [{ method, path, querystring }] }) => ({
					method,
					path,
					querystring,
				}),
			),
			[
				{
					method: 'PUT',
					path: `/${articleIndices.v1.name}/_doc/world%2F2026%2Foct%2F26%2Fexample`,
					querystring: { version: 1, version_type: 'external' },
				},
			],
		);
	});

	void it('ignores stale writes but reports other OpenSearch errors', async () => {
		const event: SQSEvent = {
			Records: [
				record('stale', update('stale headline')),
				record('os-error', update('os-error headline')),
			],
		};

		assert.deepEqual(await handler(event), {
			batchItemFailures: [{ itemIdentifier: 'os-error' }],
		});
	});

	void it('logs the OpenSearch response body when a write fails', async (context) => {
		const consoleError = context.mock.method(console, 'error', () => {});

		await handler({
			Records: [record('os-error', update('os-error headline'))],
		});

		const [, { error }] = consoleError.mock.calls[0]?.arguments as [
			string,
			{ error: Error },
		];
		assert.match(error.message, /"statusCode":500/);
		assert.match(error.message, /"index":"articles-v1"/);
		assert.match(error.message, /"body":\{"error":"os-error reason"\}/);
	});

	void it('deletes from the v1 index', async () => {
		await handler({
			Records: [record('delete', remove('world/2026/oct/26/example'))],
		});

		assert.deepEqual(
			opensearch.mock.calls.map(({ arguments: [{ method, path }] }) => ({
				method,
				path,
			})),
			[
				{
					method: 'DELETE',
					path: `/${articleIndices.v1.name}/_doc/world%2F2026%2Foct%2F26%2Fexample`,
				},
			],
		);
	});

	void it('treats deleting a missing article as success but reports other errors', async () => {
		const event: SQSEvent = {
			Records: [
				record('missing', remove('missing/article')),
				record('os-error', remove('os-error/article')),
			],
		};

		assert.deepEqual(await handler(event), {
			batchItemFailures: [{ itemIdentifier: 'os-error' }],
		});
	});

	void it('reports only the messages that failed', async () => {
		const event: SQSEvent = {
			Records: [
				record('update', update('A headline', 'A standfirst')),
				record('update-without-standfirst', update('A headline', undefined)),
				record(
					'body-preview-embed-fails',
					update('A headline', 'A standfirst', 'this preview will fail'),
				),
				record('delete', remove('gone')),
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
