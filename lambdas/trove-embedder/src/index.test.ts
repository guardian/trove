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
	body: { headline: { value: string } };
};

// Rejects stale headlines as a version conflict and "os-error" ones as a server error
const opensearch = mock.method(
	Transport.prototype,
	'request',
	({ body }: OpenSearchRequest) => {
		const statusCode = body.headline.value.includes('stale')
			? 409
			: body.headline.value.includes('os-error')
				? 500
				: 201;
		const response = {
			body: {},
			statusCode,
			headers: {},
			warnings: null,
			meta: {} as never,
		};
		return statusCode === 201
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

const update = (headline: string): EmbeddingEvent => ({
	embeddingEventId: 'event-update',
	source: 'listener',
	eventType: 'update',
	payload: {
		articleId: 'world/2026/oct/26/example',
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

void describe('handler', () => {
	beforeEach(() => opensearch.mock.resetCalls());

	void it('writes to every index, versioned by the internal revision', async () => {
		await handler({ Records: [record('update', update('A headline'))] });

		assert.deepEqual(
			opensearch.mock.calls.map(
				({ arguments: [{ method, path, querystring }] }) => ({
					method,
					path,
					querystring,
				}),
			),
			Object.values(articleIndices).map(({ name }) => ({
				method: 'PUT',
				path: `/${name}/_doc/world%2F2026%2Foct%2F26%2Fexample`,
				querystring: { version: 1, version_type: 'external' },
			})),
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

	void it('reports only the messages that failed', async () => {
		const event: SQSEvent = {
			Records: [
				record('update', update('A headline')),
				record('delete', remove),
				record('bad-json', '{not json'),
				record('bad-schema', { eventType: 'update', payload: {} }),
				record('embed-fails', update('this will fail')),
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
