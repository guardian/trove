import type { EmbeddingEvent } from 'shared/src/embeddingEvent.ts';
import type { CapiContent } from './capi.ts';
import { toEmbeddingEvent } from './capi.ts';

export type BackfillDeps = {
	fetchPage: (afterId: string | undefined) => Promise<CapiContent[]>;
	send: (events: EmbeddingEvent[]) => Promise<void>;
	queueDepth: () => Promise<number>;
	sleep: (ms: number) => Promise<void>;
	log: (entry: Record<string, unknown>) => void;
};

export type BackfillOptions = {
	pageSize: number;
	/** Pause paging while the backfill queue holds at least this many messages. */
	maxQueueDepth: number;
	backoffMs: number;
	signal: AbortSignal;
};

export type BackfillResult = {
	complete: boolean;
	pages: number;
	sent: number;
	skipped: number;
	lastSeenId?: string;
	lastSeenWebPublicationDate?: string;
};

export async function runBackfill(
	deps: BackfillDeps,
	{ pageSize, maxQueueDepth, backoffMs, signal }: BackfillOptions,
): Promise<BackfillResult> {
	const result: BackfillResult = {
		complete: false,
		pages: 0,
		sent: 0,
		skipped: 0,
	};

	while (!signal.aborted) {
		// Back-pressure: the embedder is deliberately throttled, so don't let the
		// queue grow unbounded (messages would expire before being embedded).
		const depth = await deps.queueDepth();
		if (depth >= maxQueueDepth) {
			deps.log({ message: 'Queue is full, waiting', depth });
			await deps.sleep(backoffMs);
			continue;
		}

		const results = await deps.fetchPage(result.lastSeenId);
		const events = results.flatMap(
			(content) => toEmbeddingEvent(content) ?? [],
		);
		await deps.send(events);

		result.pages++;
		result.sent += events.length;
		result.skipped += results.length - events.length;
		const last = results.at(-1);
		if (last) {
			result.lastSeenId = last.id;
			result.lastSeenWebPublicationDate = last.webPublicationDate;
		}
		// Logged every page so a failed or stopped run can be resumed from (or
		// shortly before) lastSeenWebPublicationDate; re-embedding is idempotent.
		deps.log({ message: 'Processed page', ...result });

		if (results.length < pageSize) {
			result.complete = true;
			break;
		}
	}
	return result;
}
