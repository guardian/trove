import type { SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async () => {
	console.log('hello world');
	await Promise.resolve();
};
