import assert from 'node:assert/strict';
import { it } from 'node:test';
import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { decodeThrift } from './thrift.ts';

void it('decodes a known Crier record (guards against encoder/decoder drift)', () => {
	const bytes = Buffer.from('1803612f62150215021680a0abfef96200', 'hex');

	const event = decodeThrift(bytes, EventSerde);

	assert.equal(event.payloadId, 'a/b');
	assert.equal(event.eventType, EventType.UPDATE);
	assert.equal(event.itemType, ItemType.CONTENT);
	assert.equal(event.dateTime.toNumber(), 1_700_000_000_000);
});
