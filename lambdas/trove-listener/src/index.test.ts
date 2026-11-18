import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
	SendMessageBatchCommand,
	SendMessageBatchCommandOutput,
} from '@aws-sdk/client-sqs';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { TagType } from '@guardian/content-api-models/v1/tagType.js';
import type {
	Context,
	KinesisStreamEvent,
	KinesisStreamRecord,
} from 'aws-lambda';
import { EmbeddingEvent } from 'shared/embeddingEvent';
import { Int64, TCompactProtocol, TFramedTransport } from 'thrift';
import { createListenerHandler } from './index.ts';

const context = {} as Context;
const callback = () => undefined;

const encode = (event: Event): string => {
	let framed: Buffer = Buffer.alloc(0);
	const transport = new TFramedTransport(undefined, (buffer?: Buffer) => {
		if (buffer) {
			framed = buffer;
		}
	});
	EventSerde.write(new TCompactProtocol(transport), event);
	transport.flush();
	return Buffer.from(framed.subarray(4)).toString('base64');
};

const record = (
	sequenceNumber: string,
	event: Event | 'malformed',
): KinesisStreamRecord =>
	({
		kinesis: {
			data:
				event === 'malformed'
					? Buffer.from('malformed').toString('base64')
					: encode(event),
			sequenceNumber,
		},
	}) as KinesisStreamRecord;

const crierEvent = (
	payloadId: string,
	eventType: EventType,
	payload?: Event['payload'],
): Event => ({
	payloadId,
	eventType,
	itemType: ItemType.CONTENT,
	dateTime: new Int64(100),
	payload,
});

const kinesisEvent = (
	...records: KinesisStreamRecord[]
): KinesisStreamEvent => ({ Records: records });

const successResponse = (): SendMessageBatchCommandOutput => ({
	$metadata: {},
	Successful: [],
	Failed: [],
});

const sentBodies = (command: SendMessageBatchCommand) =>
	command.input.Entries?.map((entry) =>
		EmbeddingEvent.parse(JSON.parse(entry.MessageBody ?? '{}')),
	) ?? [];

const capiContent: Content = {
	id: 'world/2026/oct/30/example',
	type: 0,
	webPublicationDate: {
		dateTime: new Int64(100),
		iso8601: '2026-10-30T10:00:00Z',
	},
	webTitle: 'Latest headline',
	webUrl: 'https://www.theguardian.com/world/2026/oct/30/example',
	apiUrl: 'https://content.guardianapis.com/world/2026/oct/30/example',
	fields: {
		headline: 'Latest headline',
		standfirst: 'Latest standfirst',
		byline: 'A Reporter',
		internalRevision: 42,
	},
	tags: [{ id: 'world/world', type: TagType.KEYWORD }] as Content['tags'],
	references: [],
	isHosted: false,
};

void describe('listener handler', () => {
	void it('sends delete and update events as one SQS batch', async () => {
		const sent: SendMessageBatchCommand[] = [];
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			sendBatch: (command) => {
				sent.push(command);
				return Promise.resolve(successResponse());
			},
			getCapiKey: () => Promise.resolve('test-key'),
			fetchCapiContent: () => Promise.resolve(capiContent),
		});

		await handler(
			kinesisEvent(
				record(
					'delete-1',
					crierEvent('world/2026/oct/30/deleted', EventType.DELETE),
				),
				record(
					'update-1',
					crierEvent(
						'world/2026/oct/30/example-update',
						EventType.RETRIEVABLEUPDATE,
						{
							kind: 'retrievableContent',
							retrievableContent: {
								id: 'world/2026/oct/30/example',
								capiUrl:
									'https://content.guardianapis.com/world/2026/oct/30/example',
								lastModifiedDate: new Int64(100),
								internalRevision: 42,
							},
						},
					),
				),
			),
			context,
			callback,
		);

		assert.equal(sent.length, 1);
		const sentBatch = sent[0];
		assert.ok(sentBatch);
		assert.equal(sentBatch.input.QueueUrl, 'test-queue');
		assert.equal(sentBatch.input.Entries?.length, 2);

		const [remove, update] = sentBodies(sentBatch);
		assert.ok(remove);
		assert.ok(update);
		assert.equal(remove.eventType, 'delete');
		assert.equal(update.eventType, 'update');
		assert.equal(update.payload.articleId, 'world/2026/oct/30/example');
		assert.equal(update.payload.headline, 'Latest headline');
		assert.deepEqual(update.payload.keywordTagIds, ['world/world']);
		assert.ok(update.embeddingEventId);
	});

	void it('stops processing and retries the batch at the first transformation error', async () => {
		let sentBatch = false;
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			sendBatch: () => {
				sentBatch = true;
				return Promise.resolve(successResponse());
			},
			getCapiKey: () => Promise.resolve(undefined),
			fetchCapiContent: () =>
				Promise.reject(new Error('CAPI should not be fetched')),
		});

		await assert.rejects(async () => {
			await handler(
				kinesisEvent(
					record(
						'delete-1',
						crierEvent('world/2026/oct/30/first', EventType.DELETE),
					),
					record('malformed-1', 'malformed'),
					record(
						'delete-2',
						crierEvent('world/2026/oct/30/later', EventType.DELETE),
					),
				),
				context,
				callback,
			);
		}, /underrun/i);
		assert.equal(sentBatch, false);
	});

	void it('fails the Kinesis batch when SQS rejects an entry', async () => {
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			sendBatch: () =>
				Promise.resolve({
					$metadata: {},
					Successful: [],
					Failed: [
						{
							Id: '0',
							Code: 'InternalError',
							Message: 'Test SQS failure',
							SenderFault: false,
						},
					],
				}),
			getCapiKey: () => Promise.resolve(undefined),
			fetchCapiContent: () =>
				Promise.reject(new Error('CAPI should not be fetched')),
		});

		await assert.rejects(async () => {
			await handler(
				kinesisEvent(
					record(
						'delete-1',
						crierEvent('world/2026/oct/30/example', EventType.DELETE),
					),
				),
				context,
				callback,
			);
		}, /One or more SQS messages failed to send/);
	});
});
