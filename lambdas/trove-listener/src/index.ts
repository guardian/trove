import type { KinesisStreamHandler } from 'aws-lambda';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import { readableCrierEvent } from './readableCrierEvent.ts';

export const handler: KinesisStreamHandler = async (event) => {
	const crierEvents = event.Records.map((r) => {
		return decodeAndParseCrierEvent(r.kinesis.data);
	});
	crierEvents.forEach((event) => {
		const readableEvent = readableCrierEvent(event);
		console.log(
			readableEvent.payloadId,
			readableEvent.eventType,
			readableEvent.itemType,
		);
	});
	await Promise.resolve();
};
