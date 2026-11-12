import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GetQueueAttributesCommand,
	SendMessageBatchCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import type { EmbeddingEvent } from 'shared/src/embeddingEvent.ts';
import { createQueue } from './queue.ts';

const event = (id: number): EmbeddingEvent => ({
	embeddingEventId: String(id),
	source: 'backfiller',
	eventType: 'delete',
	payload: { articleId: `article/${id}` },
});

void describe('createQueue', () => {
	void it('sends batches of at most ten and sends nothing for an empty page', async (context) => {
		const sqs = new SQSClient({});
		const batches: SendMessageBatchCommand[] = [];
		context.mock.method(sqs, 'send', (command: SendMessageBatchCommand) => {
			assert.ok(command instanceof SendMessageBatchCommand);
			batches.push(command);
			return Promise.resolve({});
		});
		const queue = createQueue(sqs, 'test-queue');
		const events = Array.from({ length: 21 }, (_, id) => event(id));
		await queue.send(events);
		await queue.send([]);
		assert.deepEqual(
			batches.map((command) => command.input.Entries?.length),
			[10, 10, 1],
		);
		assert.ok(
			batches.every((command) => command.input.QueueUrl === 'test-queue'),
		);
		assert.deepEqual(
			batches.flatMap((command) =>
				command.input.Entries?.map((entry) => entry.MessageBody),
			),
			events.map((entry) => JSON.stringify(entry)),
		);
	});

	void it('fails on partial SQS failures instead of advancing past unsent articles', async (context) => {
		const sqs = new SQSClient({});
		const send = context.mock.method(sqs, 'send', () =>
			Promise.resolve({
				Failed: [{ Id: '0', Code: 'ServiceUnavailable', SenderFault: false }],
			}),
		);
		await assert.rejects(
			createQueue(sqs, 'test-queue').send(
				Array.from({ length: 11 }, (_, id) => event(id)),
			),
			/Failed to enqueue 1 messages/,
		);
		assert.equal(send.mock.callCount(), 1);
	});

	void it('reads queue depth and rejects missing or invalid attributes', async (context) => {
		const sqs = new SQSClient({});
		let depth: string | undefined = '10000';
		context.mock.method(sqs, 'send', (command: GetQueueAttributesCommand) => {
			assert.ok(command instanceof GetQueueAttributesCommand);
			assert.equal(command.input.QueueUrl, 'test-queue');
			assert.deepEqual(command.input.AttributeNames, [
				'ApproximateNumberOfMessages',
			]);
			return Promise.resolve({
				Attributes: { ApproximateNumberOfMessages: depth },
			});
		});
		const queue = createQueue(sqs, 'test-queue');
		assert.equal(await queue.depth(), 10000);
		for (depth of [undefined, 'not-a-number', '-1']) {
			await assert.rejects(queue.depth(), /invalid or missing queue depth/);
		}
	});
});
