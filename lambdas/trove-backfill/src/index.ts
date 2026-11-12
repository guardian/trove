import { SQSClient } from '@aws-sdk/client-sqs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Handler } from 'aws-lambda';
import type { BackfillResult } from './backfill.ts';
import { BackfillState, PAGE_SIZE, runBackfill } from './backfill.ts';
import { createCapiPageFetcher } from './capi.ts';
import { createQueue } from './queue.ts';

const sqs = new SQSClient({});
const ssm = new SSMClient({});
let apiKey: string | undefined;

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
}

export const handler: Handler<unknown, BackfillResult> = async (
	event,
	context,
) => {
	const state = BackfillState.parse(event);
	if (!apiKey) {
		const { Parameter } = await ssm.send(
			new GetParameterCommand({
				Name: requireEnv('CAPI_API_KEY_PARAMETER_NAME'),
				WithDecryption: true,
			}),
		);
		if (!Parameter?.Value) {
			throw new Error('CAPI API key parameter is empty');
		}
		apiKey = Parameter.Value;
	}
	const queue = createQueue(sqs, requireEnv('BACKFILL_EMBEDDER_QUEUE_URL'));
	return runBackfill(state, {
		fetchPage: createCapiPageFetcher({
			baseUrl: process.env.CAPI_URL ?? 'https://content.guardianapis.com',
			apiKey,
			pageSize: PAGE_SIZE,
			fromDate: state.fromDate,
			toDate: state.toDate,
		}),
		send: queue.send,
		queueDepth: queue.depth,
		remainingTimeInMillis: () => context.getRemainingTimeInMillis(),
		log: (entry) => console.log(JSON.stringify(entry)),
	});
};
