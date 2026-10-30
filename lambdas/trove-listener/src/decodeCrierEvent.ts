import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { Int64, TCompactProtocol, TFramedTransport } from 'thrift';

/**
 * Crier records are headerless, uncompressed TCompactProtocol `Event`s.
 * Trailing padding after the struct is ignored by the reader.
 */
export function decodeCrierEvent(data: Uint8Array): Event {
	const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	// TFramedTransport given a buffer reads it directly; no frame-length prefix is expected.
	return EventSerde.read(new TCompactProtocol(new TFramedTransport(buffer)));
}

/** JSON.stringify replacer that renders Thrift Int64s and Crier enums readably. */
export function eventJsonReplacer(
	this: unknown,
	key: string,
	value: unknown,
): unknown {
	if (value instanceof Int64) {
		return value.toNumber();
	}
	if (key === 'eventType' && typeof value === 'number') {
		return EventType[value] ?? value;
	}
	if (key === 'itemType' && typeof value === 'number') {
		return ItemType[value] ?? value;
	}
	return value;
}
