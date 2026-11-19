import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { encodeThrift } from 'shared/thrift';
import { Int64 } from 'thrift';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import { readableCrierEvent } from './readableCrierEvent.ts';

const encode = (event: Event): Uint8Array => encodeThrift(event, EventSerde);

const b64 = (bytes: Uint8Array): string =>
	Buffer.from(bytes).toString('base64');

const baseEvent: Event = {
	payloadId: 'world/2026/oct/30/example',
	eventType: EventType.UPDATE,
	itemType: ItemType.CONTENT,
	dateTime: new Int64(1_700_000_000_000),
};

const expectedJson = {
	payloadId: 'world/2026/oct/30/example',
	eventType: 'UPDATE',
	itemType: 'CONTENT',
	dateTime: 1_700_000_000_000,
};

void describe('decodeEvent', () => {
	void it('decodes a headerless compact-protocol Event', () => {
		const event = decodeAndParseCrierEvent(b64(encode(baseEvent)));

		assert.equal(event.payloadId, baseEvent.payloadId);
		assert.equal(event.eventType, EventType.UPDATE);
		assert.equal(event.itemType, ItemType.CONTENT);
		assert.ok(event.dateTime instanceof Int64);
		assert.equal(event.dateTime.toNumber(), 1_700_000_000_000);
		assert.equal(event.payload, undefined);
	});

	void it('decodes a known byte sequence (guards against encoder/decoder drift)', () => {
		const bytes = Buffer.from('1803612f62150215021680a0abfef96200', 'hex');

		assert.deepStrictEqual(
			readableCrierEvent(decodeAndParseCrierEvent(b64(bytes))),
			{
				payloadId: 'a/b',
				eventType: 'UPDATE',
				itemType: 'CONTENT',
				dateTime: 1_700_000_000_000,
			},
		);
	});

	void it('decodes a payload union', () => {
		const event = decodeAndParseCrierEvent(
			b64(
				encode({
					...baseEvent,
					eventType: EventType.RETRIEVABLEUPDATE,
					payload: {
						kind: 'retrievableContent',
						retrievableContent: {
							id: 'world/2026/oct/30/example',
							capiUrl:
								'https://content.guardianapis.com/world/2026/oct/30/example',
							lastModifiedDate: new Int64(1_700_000_000_001),
							internalRevision: 42,
						},
					},
				}),
			),
		);

		assert.deepStrictEqual(readableCrierEvent(event), {
			...expectedJson,
			eventType: 'RETRIEVABLEUPDATE',
			payload: {
				kind: 'retrievableContent',
				retrievableContent: {
					id: 'world/2026/oct/30/example',
					capiUrl: 'https://content.guardianapis.com/world/2026/oct/30/example',
					lastModifiedDate: 1_700_000_000_001,
					internalRevision: 42,
				},
			},
		});
	});
});
