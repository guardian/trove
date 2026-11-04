import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { Int64, TCompactProtocol, TFramedTransport } from 'thrift';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import { readableCrierEvent } from './readableCrierEvent.ts';

/** Encodes an Event the way Crier does: compact protocol, no frame-length prefix. */
const encode = (event: Event): Uint8Array => {
	let framed: Buffer = Buffer.alloc(0);
	const transport = new TFramedTransport(undefined, (buffer?: Buffer) => {
		if (buffer) {
			framed = buffer;
		}
	});
	EventSerde.write(new TCompactProtocol(transport), event);
	transport.flush();
	// TFramedTransport.flush prepends a 4-byte length, which Crier records don't have.
	return framed.subarray(4);
};

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
