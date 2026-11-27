import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { EmbeddingEvent } from './embeddingEvent.ts';
import { sendEmbeddingEvents } from './sqs.ts';

const events = (count: number): EmbeddingEvent[] =>
	Array.from({ length: count }, () => ({
		embeddingEventId: randomUUID(),
		source: 'backfiller',
		eventType: 'delete',
		payload: { articleId: 'world/2026/oct/30/example' },
	}));

void describe('sendEmbeddingEvents', () => {
	void it('sends events in batches of at most 10', async (t) => {
		const send = t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({ Failed: [] }),
		);

		await sendEmbeddingEvents('https://sqs/queue', events(25));

		const batchSizes = send.mock.calls.map(
			(call) =>
				(call.arguments[0] as unknown as SendMessageBatchCommand).input.Entries
					?.length,
		);
		assert.deepStrictEqual(batchSizes, [10, 10, 5]);
	});

	void it('throws if any message fails to send', async (t) => {
		t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({ Failed: [{ Id: 'x', SenderFault: false, Code: 'e' }] }),
		);

		await assert.rejects(
			sendEmbeddingEvents('https://sqs/queue', events(1)),
			/Failed to send 1 messages/,
		);
	});
});
