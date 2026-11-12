import { setTimeout as sleep } from 'node:timers/promises';
import { SQSClient } from '@aws-sdk/client-sqs';
import { runBackfill } from './backfill.ts';
import { createCapiPageFetcher } from './capi.ts';
import { createQueue } from './queue.ts';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
}

const log = (entry: Record<string, unknown>) =>
	console.log(JSON.stringify(entry));

async function main() {
	const dryRun = process.env.DRY_RUN === 'true';
	const pageSize = Number(process.env.PAGE_SIZE ?? 200);
	const fromDate = process.env.FROM_DATE;
	const toDate = process.env.TO_DATE;

	// ECS sends SIGTERM (then SIGKILL after 30s) when a task is stopped.
	// Finish the current page and log the cursor rather than dying mid-batch.
	const controller = new AbortController();
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.on(signal, () => {
			log({ message: `Received ${signal}, stopping after current page` });
			controller.abort();
		});
	}

	const fetchPage = createCapiPageFetcher({
		baseUrl: process.env.CAPI_URL ?? 'https://content.guardianapis.com',
		apiKey: requireEnv('CAPI_API_KEY'),
		pageSize,
		fromDate,
		toDate,
	});
	const queue = dryRun
		? {
				send: (events: unknown[]) => {
					log({ message: 'DRY_RUN: would enqueue', count: events.length });
					return Promise.resolve();
				},
				depth: () => Promise.resolve(0),
			}
		: createQueue(new SQSClient({}), requireEnv('BACKFILL_EMBEDDER_QUEUE_URL'));

	log({ message: 'Starting backfill', fromDate, toDate, pageSize, dryRun });
	const result = await runBackfill(
		{
			fetchPage,
			send: queue.send,
			queueDepth: queue.depth,
			sleep: (ms) =>
				sleep(ms, undefined, { signal: controller.signal }).catch(() => {}),
			log,
		},
		{
			pageSize,
			maxQueueDepth: Number(process.env.MAX_QUEUE_DEPTH ?? 10_000),
			backoffMs: 30_000,
			signal: controller.signal,
		},
	);
	log({ message: 'Backfill finished', ...result });
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
