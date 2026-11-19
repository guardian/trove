import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { decodeThrift } from 'shared/thrift';

export function decodeAndParseCrierEvent(data: string): Event {
	return decodeThrift(Buffer.from(data, 'base64'), EventSerde);
}
