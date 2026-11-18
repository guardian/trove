import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SendMessageCommand } from '@aws-sdk/client-sqs';
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

const event = (
	payloadId: string,
	eventType: EventType,
	dateTime: number,
	payload?: Event['payload'],
): Event => ({
	payloadId,
	eventType,
	itemType: ItemType.CONTENT,
	dateTime: new Int64(dateTime),
	payload,
});

const kinesisEvent = (records: KinesisStreamRecord[]): KinesisStreamEvent => ({
	Records: records,
});

const context = {} as Context;
const callback = () => undefined;

void describe('listener handler', () => {
	void it('sends delete events', async () => {
		const sent: SendMessageCommand[] = [];
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			send: (command) => {
				sent.push(command);
				return Promise.resolve(undefined);
			},
			getCapiKey: () => Promise.resolve('test-key'),
			fetchCapiContent: () =>
				Promise.reject(new Error('CAPI should not be fetched')),
		});

		const result = await handler(
			kinesisEvent([
				record(
					'delete-1',
					event('world/2026/oct/30/example', EventType.DELETE, 100),
				),
			]),
			context,
			callback,
		);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.equal(sent.length, 1);
		const sentDelete = sent[0];
		assert.ok(sentDelete);
		assert.equal(sentDelete.input.QueueUrl, 'test-queue');
		const body = EmbeddingEvent.parse(
			JSON.parse(sentDelete.input.MessageBody ?? '{}'),
		);
		assert.deepEqual(body, {
			embeddingEventId: body.embeddingEventId,
			source: 'listener',
			eventType: 'delete',
			payload: { articleId: 'world/2026/oct/30/example' },
		});
	});

	void it('fetches retrievable updates', async () => {
		const sent: SendMessageCommand[] = [];
		let fetchedUrl: string | undefined;
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			send: (command) => {
				sent.push(command);
				return Promise.resolve(undefined);
			},
			getCapiKey: () => Promise.resolve('test-key'),
			fetchCapiContent: (url) => {
				fetchedUrl = url;
				return Promise.resolve({
					id: 'world/2026/oct/30/example',
					type: 'article',
					webPublicationDate: '2026-10-30T10:00:00Z',
					fields: {
						headline: 'Latest headline',
						standfirst: 'Latest standfirst',
						byline: 'A Reporter',
						internalRevision: 42,
					},
					tags: [{ id: 'world/world', type: TagType.KEYWORD }],
					webTitle: 'Latest headline',
					webUrl: 'https://www.theguardian.com/world/2026/oct/30/example',
					apiUrl: 'https://content.guardianapis.com/world/2026/oct/30/example',
					references: [],
					isHosted: false,
				} as unknown as Content);
			},
		});

		const retrievable = (dateTime: number, revision: number): Event =>
			event(
				`world/2026/oct/30/example-${dateTime}`,
				EventType.RETRIEVABLEUPDATE,
				dateTime,
				{
					kind: 'retrievableContent',
					retrievableContent: {
						id: 'world/2026/oct/30/example',
						capiUrl:
							'https://content.guardianapis.com/world/2026/oct/30/example',
						lastModifiedDate: new Int64(dateTime),
						internalRevision: revision,
					},
				},
			);

		const result = await handler(
			kinesisEvent([
				record('old', retrievable(100, 41)),
				record('latest', retrievable(200, 42)),
			]),
			context,
			callback,
		);

		assert.deepEqual(result, { batchItemFailures: [] });
		assert.equal(
			fetchedUrl,
			'https://content.guardianapis.com/world/2026/oct/30/example',
		);
		assert.equal(sent.length, 2);
		const sentUpdate = sent[1];
		assert.ok(sentUpdate);
		const body = EmbeddingEvent.parse(
			JSON.parse(sentUpdate.input.MessageBody ?? '{}'),
		);
		assert.equal(body.eventType, 'update');
		assert.equal(body.payload.headline, 'Latest headline');
		assert.equal(body.payload.internalRevision, 42);
		assert.deepEqual(body.payload.keywordTagIds, ['world/world']);
	});

	void it('reports malformed records as batch failures', async () => {
		const handler = createListenerHandler({
			queueUrl: 'test-queue',
			send: () => Promise.resolve(undefined),
			getCapiKey: () => Promise.resolve(undefined),
			fetchCapiContent: () =>
				Promise.reject(new Error('CAPI should not be fetched')),
		});

		const result = await handler(
			kinesisEvent([record('malformed-1', 'malformed')]),
			context,
			callback,
		);
		assert.deepEqual(result, {
			batchItemFailures: [{ itemIdentifier: 'malformed-1' }],
		});
	});
});
