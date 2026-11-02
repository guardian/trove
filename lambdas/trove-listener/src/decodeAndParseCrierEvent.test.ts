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

	void it('ignores zero padding after the struct', () => {
		const padded = Buffer.concat([encode(baseEvent), Buffer.alloc(16)]);

		assert.deepStrictEqual(
			readableCrierEvent(decodeAndParseCrierEvent(b64(padded))),
			expectedJson,
		);
	});

	void it('passes through enum values it does not recognise', () => {
		const event = decodeAndParseCrierEvent(
			b64(
				encode({
					...baseEvent,
					eventType: 99 as EventType,
					itemType: 0 as ItemType,
				}),
			),
		);

		assert.equal(event.eventType, 99);
		assert.equal(event.itemType, 0);
	});

	void it('throws on empty input', () => {
		assert.throws(() => decodeAndParseCrierEvent(''), {
			name: 'InputBufferUnderrunError',
		});
	});

	void it('throws on truncated input', () => {
		const encoded = encode(baseEvent);

		assert.throws(
			() =>
				decodeAndParseCrierEvent(b64(encoded.subarray(0, encoded.length - 3))),
			{
				name: 'InputBufferUnderrunError',
			},
		);
	});

	/*
	 * Potential gaps: the cases below pin *current* behaviour that callers may not expect.
	 * If any of these are fixed, update the corresponding test.
	 */

	void it('GAP: ignores arbitrary trailing bytes, not just padding', () => {
		// Two concatenated records, or a corrupt tail, would be silently truncated to the first event.
		const withTrailer = Buffer.concat([
			encode(baseEvent),
			encode({ ...baseEvent, payloadId: 'second' }),
		]);

		assert.equal(
			decodeAndParseCrierEvent(b64(withTrailer)).payloadId,
			baseEvent.payloadId,
		);
	});

	void it('GAP: does not validate required fields, so the result may not match the Event type', () => {
		// Only field 1 (payloadId = "a") then STOP. EventSerde.read @ts-ignores its return value.
		const event = decodeAndParseCrierEvent(
			b64(Uint8Array.of(0x18, 0x01, 0x61, 0x00)),
		);

		assert.deepStrictEqual(Object.keys(event), ['payloadId']);
		assert.equal(event.eventType, undefined);
		assert.equal(event.dateTime, undefined);
	});

	void it('GAP: a lone STOP byte decodes to an empty object rather than throwing', () => {
		assert.deepStrictEqual(
			decodeAndParseCrierEvent(b64(Uint8Array.of(0x00))),
			{},
		);
	});

	void it('GAP: a record that does have a frame-length prefix silently decodes to {}', () => {
		// The first prefix byte is 0x00 (for any record < 16 MiB), which reads as a STOP field.
		const encoded = encode(baseEvent);
		const prefix = Buffer.alloc(4);
		prefix.writeInt32BE(encoded.length);

		assert.deepStrictEqual(
			decodeAndParseCrierEvent(b64(Buffer.concat([prefix, encoded]))),
			{},
		);
	});

	void it('GAP: fields with an unexpected wire type are skipped rather than rejected', () => {
		// Field 2 (eventType) encoded as a string instead of an i32.
		assert.deepStrictEqual(
			decodeAndParseCrierEvent(b64(Uint8Array.of(0x28, 0x01, 0x61, 0x00))),
			{},
		);
	});
});
