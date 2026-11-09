import type { Handler } from 'aws-lambda';

export const handler: Handler = async () => {
	console.log('hello world');
	await Promise.resolve();
};
