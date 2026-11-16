/**
 * Runs the embedder handler locally against real Bedrock, with each message in a
 * JSON file sent as one SQS record. Needs Janus credentials for the `capi` profile.
 *
 *   npm run invoke-local -w trove-embedder                       # scripts/events/sample.json
 *   npm run invoke-local -w trove-embedder -- path/to/events.json
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

process.env.AWS_PROFILE ??= 'capi';
process.env.AWS_REGION ??= 'eu-west-1';

// Imported after setting the env so the Bedrock client picks it up
const { handler } = await import('../src/index.ts');

const file = resolve(
	process.argv[2] ?? new URL('events/sample.json', import.meta.url).pathname,
);
const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
const messages = Array.isArray(parsed) ? parsed : [parsed];

const event: SQSEvent = {
	Records: messages.map(
		(message, i) =>
			({
				messageId: `local-${i}`,
				body: JSON.stringify(message),
			}) as SQSRecord,
	),
};

console.log(
	`Invoking handler with ${event.Records.length} message(s) from ${file}`,
);
const response = await handler(event);
console.log('Response:', JSON.stringify(response, null, 2));
