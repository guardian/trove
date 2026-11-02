import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { Int64 } from 'thrift';

export function readableCrierEvent(event: Event) {
	return Object.fromEntries(
		Object.entries(event).map(([key, value]) => [
			key,
			readableCrierEventValue(key, value),
		]),
	);
}

function readableCrierEventValue(key: string, value: unknown) {
	if (key === 'eventType' && typeof value === 'number') {
		return EventType[value] ?? value;
	}
	if (key === 'itemType' && typeof value === 'number') {
		return ItemType[value] ?? value;
	}
	return readableValue(value);
}

function readableValue(value: unknown): unknown {
	if (value instanceof Int64) {
		return value.toNumber();
	}
	if (Array.isArray(value)) {
		return value.map(readableValue);
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, nested]) => [
				key,
				readableValue(nested),
			]),
		);
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
