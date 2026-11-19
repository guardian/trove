import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { sampleContent } from 'shared/fixtures';
import { encodeThrift } from 'shared/thrift';
import { Int64 } from 'thrift';
import { processBatch } from './index.ts';

const kinesisRecord = (event: Event): KinesisStreamRecord =>
	({
		kinesis: { data: encodeThrift(event, EventSerde).toString('base64') },
	}) as KinesisStreamRecord;

const batch: KinesisStreamEvent = {
	Records: [
		kinesisRecord({
			payloadId: sampleContent.id,
			eventType: EventType.UPDATE,
			itemType: ItemType.CONTENT,
			dateTime: new Int64(1_700_000_000_000),
			payload: { kind: 'content', content: sampleContent },
		}),
		kinesisRecord({
			payloadId: 'gone',
			eventType: EventType.DELETE,
			itemType: ItemType.CONTENT,
			dateTime: new Int64(1_700_000_000_000),
		}),
		kinesisRecord({
			payloadId: 'tone/news',
			eventType: EventType.UPDATE,
			itemType: ItemType.TAG,
			dateTime: new Int64(1_700_000_000_000),
		}),
	],
};

const noFetch = () => Promise.reject(new Error('Unexpected CAPI fetch'));

void describe('processBatch', () => {
	void it('sends all embedding events in a single SQS batch', async (t) => {
		const send = t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({ Successful: [], Failed: [] }),
		);

		await processBatch(batch, noFetch, 'https://sqs/queue');

		assert.equal(send.mock.callCount(), 1);
		const command = send.mock.calls[0]
			?.arguments[0] as unknown as SendMessageBatchCommand;
		const bodies = (command.input.Entries ?? []).map(
			(e) => JSON.parse(e.MessageBody ?? '') as { eventType: string },
		);
		assert.deepStrictEqual(
			bodies.map((b) => b.eventType),
			['update', 'delete'],
		);
	});

	void it('fails the whole batch if any message fails to send', async (t) => {
		t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({ Failed: [{ Id: 'x', SenderFault: false, Code: 'e' }] }),
		);

		await assert.rejects(
			processBatch(batch, noFetch, 'https://sqs/queue'),
			/Failed to send 1 messages/,
		);
	});

	void it('fails the whole batch if a CAPI fetch fails', async (t) => {
		const send = t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({}),
		);
		const retrievable = kinesisRecord({
			payloadId: sampleContent.id,
			eventType: EventType.RETRIEVABLEUPDATE,
			itemType: ItemType.CONTENT,
			dateTime: new Int64(1_700_000_000_000),
			payload: {
				kind: 'retrievableContent',
				retrievableContent: {
					id: sampleContent.id,
					capiUrl: sampleContent.apiUrl,
				},
			},
		});

		await assert.rejects(
			processBatch(
				{ Records: [...batch.Records, retrievable] },
				noFetch,
				'https://sqs/queue',
			),
			/Unexpected CAPI fetch/,
		);
		assert.equal(send.mock.callCount(), 0);
	});
});
