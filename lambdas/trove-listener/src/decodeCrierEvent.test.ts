import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { Int64, TCompactProtocol, TFramedTransport } from 'thrift';
import { decodeCrierEvent, eventJsonReplacer } from './decodeCrierEvent.ts';

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

const toJson = (value: unknown) => JSON.stringify(value, eventJsonReplacer);

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
		const event = decodeCrierEvent(encode(baseEvent));

		assert.equal(event.payloadId, baseEvent.payloadId);
		assert.equal(event.eventType, EventType.UPDATE);
		assert.equal(event.itemType, ItemType.CONTENT);
		assert.ok(event.dateTime instanceof Int64);
		assert.equal(event.dateTime.toNumber(), 1_700_000_000_000);
		assert.equal(event.payload, undefined);
	});

	void it('decodes a known byte sequence (guards against encoder/decoder drift)', () => {
		const bytes = Buffer.from('1803612f62150215021680a0abfef96200', 'hex');

		assert.deepStrictEqual(JSON.parse(toJson(decodeCrierEvent(bytes))), {
			payloadId: 'a/b',
			eventType: 'UPDATE',
			itemType: 'CONTENT',
			dateTime: 1_700_000_000_000,
		});
	});

	void it('decodes a payload union', () => {
		const event = decodeCrierEvent(
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
		);

		assert.deepStrictEqual(JSON.parse(toJson(event)), {
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

	void it('respects byteOffset/byteLength of a Uint8Array view onto a larger buffer', () => {
		const encoded = encode(baseEvent);
		const backing = new Uint8Array(encoded.length + 16).fill(0xff);
		backing.set(encoded, 8);

		const event = decodeCrierEvent(backing.subarray(8, 8 + encoded.length));

		assert.deepStrictEqual(JSON.parse(toJson(event)), expectedJson);
	});

	void it('does not retain references to the input buffer', () => {
		const input = Buffer.from(encode(baseEvent));
		const event = decodeCrierEvent(input);

		input.fill(0);

		assert.deepStrictEqual(JSON.parse(toJson(event)), expectedJson);
	});

	void it('ignores zero padding after the struct', () => {
		const padded = Buffer.concat([encode(baseEvent), Buffer.alloc(16)]);

		assert.deepStrictEqual(
			JSON.parse(toJson(decodeCrierEvent(padded))),
			expectedJson,
		);
	});

	void it('passes through enum values it does not recognise', () => {
		const event = decodeCrierEvent(
			encode({
				...baseEvent,
				eventType: 99 as EventType,
				itemType: 0 as ItemType,
			}),
		);

		assert.equal(event.eventType, 99);
		assert.equal(event.itemType, 0);
	});

	void it('throws on empty input', () => {
		assert.throws(() => decodeCrierEvent(new Uint8Array()), {
			name: 'InputBufferUnderrunError',
		});
	});

	void it('throws on truncated input', () => {
		const encoded = encode(baseEvent);

		assert.throws(
			() => decodeCrierEvent(encoded.subarray(0, encoded.length - 3)),
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

		assert.equal(decodeCrierEvent(withTrailer).payloadId, baseEvent.payloadId);
	});

	void it('GAP: does not validate required fields, so the result may not match the Event type', () => {
		// Only field 1 (payloadId = "a") then STOP. EventSerde.read @ts-ignores its return value.
		const event = decodeCrierEvent(Uint8Array.of(0x18, 0x01, 0x61, 0x00));

		assert.deepStrictEqual(Object.keys(event), ['payloadId']);
		assert.equal(event.eventType, undefined);
		assert.equal(event.dateTime, undefined);
	});

	void it('GAP: a lone STOP byte decodes to an empty object rather than throwing', () => {
		assert.deepStrictEqual(decodeCrierEvent(Uint8Array.of(0x00)), {});
	});

	void it('GAP: a record that does have a frame-length prefix silently decodes to {}', () => {
		// The first prefix byte is 0x00 (for any record < 16 MiB), which reads as a STOP field.
		const encoded = encode(baseEvent);
		const prefix = Buffer.alloc(4);
		prefix.writeInt32BE(encoded.length);

		assert.deepStrictEqual(
			decodeCrierEvent(Buffer.concat([prefix, encoded])),
			{},
		);
	});

	void it('GAP: fields with an unexpected wire type are skipped rather than rejected', () => {
		// Field 2 (eventType) encoded as a string instead of an i32.
		assert.deepStrictEqual(
			decodeCrierEvent(Uint8Array.of(0x28, 0x01, 0x61, 0x00)),
			{},
		);
	});
});

void describe('eventJsonReplacer', () => {
	void it('renders Int64 values as numbers', () => {
		assert.equal(
			toJson({ dateTime: new Int64(1_700_000_000_000) }),
			'{"dateTime":1700000000000}',
		);
		assert.equal(toJson({ dateTime: new Int64(-5) }), '{"dateTime":-5}');
	});

	void it('renders Int64 values in nested objects and arrays', () => {
		assert.equal(
			toJson({ a: [new Int64(1), { b: new Int64(2) }] }),
			'{"a":[1,{"b":2}]}',
		);
	});

	void it('renders known eventType and itemType values by name', () => {
		for (const [value, name] of [
			[EventType.UPDATE, 'UPDATE'],
			[EventType.DELETE, 'DELETE'],
			[EventType.RETRIEVABLEUPDATE, 'RETRIEVABLEUPDATE'],
		] as const) {
			assert.equal(toJson({ eventType: value }), `{"eventType":"${name}"}`);
		}
		for (const [value, name] of [
			[ItemType.CONTENT, 'CONTENT'],
			[ItemType.TAG, 'TAG'],
			[ItemType.SECTION, 'SECTION'],
			[ItemType.STORYPACKAGE, 'STORYPACKAGE'],
			[ItemType.ATOM, 'ATOM'],
		] as const) {
			assert.equal(toJson({ itemType: value }), `{"itemType":"${name}"}`);
		}
	});

	void it('falls back to the raw number for unknown enum values', () => {
		assert.equal(
			toJson({ eventType: 0, itemType: 99 }),
			'{"eventType":0,"itemType":99}',
		);
		assert.equal(toJson({ eventType: 1.5 }), '{"eventType":1.5}');
	});

	void it('leaves non-numeric eventType/itemType values alone', () => {
		assert.equal(
			toJson({ eventType: 'UPDATE', itemType: null }),
			'{"eventType":"UPDATE","itemType":null}',
		);
	});

	void it('leaves other values unchanged', () => {
		const value = { payloadId: 'x', count: 1, flag: true, list: [1, 'a'] };

		assert.equal(toJson(value), JSON.stringify(value));
	});

	void it('without the replacer, Int64 serialises as its internal buffer', () => {
		// Documents why the replacer is needed.
		assert.equal(
			JSON.stringify({ dateTime: new Int64(5) }),
			'{"dateTime":{"buffer":{"type":"Buffer","data":[0,0,0,0,0,0,0,5]},"offset":0}}',
		);
	});

	/*
	 * Potential gaps in the replacer.
	 */

	void it('GAP: Int64 values beyond Number.MAX_SAFE_INTEGER become null', () => {
		// Int64#toNumber() defaults to allowImprecise=false, returning ±Infinity, which JSON renders as null.
		assert.equal(
			toJson({ dateTime: new Int64('7fffffffffffffff') }),
			'{"dateTime":null}',
		);
		assert.equal(
			toJson({ dateTime: new Int64('8000000000000000') }),
			'{"dateTime":null}',
		);
	});

	void it('GAP: maps any key named eventType/itemType, at any depth, not just on the Event', () => {
		// Matching is by key name only, so unrelated nested fields with these names are rewritten too.
		assert.equal(
			toJson({ unrelated: { eventType: 2, itemType: 3 } }),
			'{"unrelated":{"eventType":"DELETE","itemType":"SECTION"}}',
		);
	});

	void it('GAP: unknown enum values are indistinguishable from raw numbers in the output', () => {
		// Known values become strings but unknown ones stay numbers, so the output type is string | number.
		const known = JSON.parse(toJson({ eventType: 1 })) as {
			eventType: unknown;
		};
		const unknown = JSON.parse(toJson({ eventType: 42 })) as {
			eventType: unknown;
		};

		assert.equal(typeof known.eventType, 'string');
		assert.equal(typeof unknown.eventType, 'number');
	});
});
