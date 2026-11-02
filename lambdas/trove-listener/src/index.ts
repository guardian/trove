import type { KinesisStreamHandler } from 'aws-lambda';
import { decodeCrierEvent, eventJsonReplacer } from './decodeCrierEvent.ts';

export const handler: KinesisStreamHandler = async (event) => {
	const crierEvents = event.Records.map((r) => {
		const base64Data = r.kinesis.data;
		const buffer = Buffer.from(base64Data, 'base64');
		return decodeCrierEvent(buffer);
	});
	crierEvents.forEach((event) => {
		console.log(JSON.stringify(event, eventJsonReplacer, 2));
	});
	await Promise.resolve();
};
