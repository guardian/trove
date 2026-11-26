import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import type { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { crierEvent, sampleContent } from 'shared/testing/fixtures';
import { encodeThrift } from 'shared/testing/thrift';
import { processBatch } from './processBatch.ts';

const batch: KinesisStreamEvent = {
	Records: [
		crierEvent({ payload: { kind: 'content', content: sampleContent } }),
		crierEvent({ eventType: EventType.DELETE }),
	].map(
		(event) =>
			({
				kinesis: { data: encodeThrift(event, EventSerde).toString('base64') },
			}) as KinesisStreamRecord,
	),
};

const noFetch = () => Promise.reject(new Error('Unexpected CAPI fetch'));

void describe('processBatch', () => {
	void it('sends all embedding events in a single SQS batch', async (t) => {
		const send = t.mock.method(SQSClient.prototype, 'send', () =>
			Promise.resolve({ Failed: [] }),
		);

		await processBatch(batch, noFetch, 'https://sqs/queue');

		assert.equal(send.mock.callCount(), 1);
		const command = send.mock.calls[0]
			?.arguments[0] as unknown as SendMessageBatchCommand;
		assert.equal(command.input.Entries?.length, 2);
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
});
