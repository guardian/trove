import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { TCompactProtocol, TFramedTransport } from 'thrift';

/**
 * Crier records are headerless, uncompressed TCompactProtocol `Event`s.
 * Trailing padding after the struct is ignored by the reader.
 */
export function decodeAndParseCrierEvent(data: string): Event {
	const buffer = Buffer.from(data, 'base64');
	// TFramedTransport given a buffer reads it directly; no frame-length prefix is expected.
	return EventSerde.read(new TCompactProtocol(new TFramedTransport(buffer)));
}
