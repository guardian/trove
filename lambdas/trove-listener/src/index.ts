import type { KinesisStreamHandler } from 'aws-lambda';
import { logRuntimeVersions } from 'shared/runtimeVersions';
import { decodeAndParseCrierEvent } from './decodeAndParseCrierEvent.ts';
import { readableCrierEvent } from './readableCrierEvent.ts';

// Module scope, so this runs once per cold start
logRuntimeVersions();

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
