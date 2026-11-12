import type { EmbeddingEvent } from 'shared/src/embeddingEvent.ts';
import { z } from 'zod';
import type { CapiContent } from './capi.ts';
import { toEmbeddingEvent } from './capi.ts';

const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const BackfillState = z
	.object({
		fromDate: date,
		toDate: date,
		lastSeenId: z.string().min(1).optional(),
		lastSeenWebPublicationDate: z.string().optional(),
		pages: z.number().int().nonnegative().default(0),
		sent: z.number().int().nonnegative().default(0),
		skipped: z.number().int().nonnegative().default(0),
	})
	.refine((state) => Date.parse(state.fromDate) <= Date.parse(state.toDate), {
		message: 'fromDate must not be later than toDate',
	});
export type BackfillState = z.infer<typeof BackfillState>;

export type BackfillResult = BackfillState & {
	complete: boolean;
	waiting: boolean;
};

export type BackfillDeps = {
	fetchPage: (afterId: string | undefined) => Promise<CapiContent[]>;
	send: (events: EmbeddingEvent[]) => Promise<void>;
	queueDepth: () => Promise<number>;
	remainingTimeInMillis: () => number;
	log: (entry: Record<string, unknown>) => void;
};

export const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const MAX_QUEUE_DEPTH = 10_000;
// Leave room for CAPI's three 30-second attempts and for enqueueing the page.
const PAGE_TIME_RESERVE_MS = 120_000;

export async function runBackfill(
	state: BackfillState,
	deps: BackfillDeps,
): Promise<BackfillResult> {
	const result: BackfillResult = { ...state, complete: false, waiting: false };

	for (let page = 0; page < MAX_PAGES; page++) {
		if (deps.remainingTimeInMillis() < PAGE_TIME_RESERVE_MS) {
			deps.log({ message: 'Yielding before Lambda timeout', ...result });
			break;
		}
		const depth = await deps.queueDepth();
		if (depth >= MAX_QUEUE_DEPTH) {
			result.waiting = true;
			deps.log({ message: 'Queue is full, waiting', depth, ...result });
			break;
		}

		const contents = await deps.fetchPage(result.lastSeenId);
		const events = contents.flatMap((content) => {
			const event = toEmbeddingEvent(content);
			if (!event) {
				deps.log({
					message: 'Skipping invalid embedding content',
					articleId: content.id,
				});
			}
			return event ?? [];
		});
		await deps.send(events);

		result.pages++;
		result.sent += events.length;
		result.skipped += contents.length - events.length;
		const last = contents.at(-1);
		if (last) {
			result.lastSeenId = last.id;
			result.lastSeenWebPublicationDate = last.webPublicationDate;
		}
		result.complete = contents.length < PAGE_SIZE;
		deps.log({ message: 'Processed page', ...result });
		if (result.complete) {
			break;
		}
	}
	return result;
}
