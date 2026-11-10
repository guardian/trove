import { z } from 'zod';

const CapiItem = z.object({
	id: z.string(),
	webPublicationDate: z.string().optional(),
	fields: z.record(z.string(), z.string()).optional(),
	tags: z.array(z.object({ id: z.string() })).optional(),
});
export type CapiItem = z.infer<typeof CapiItem>;

const CapiResponse = z.object({
	response: z.object({
		total: z.number(),
		results: z.array(CapiItem),
	}),
});

export type Page = {
	results: CapiItem[];
	total: number;
	url: string;
};

export type PaginateOptions = {
	baseUrl: string;
	apiKey: string;
	params: Record<string, string>;
	pageSize: number;
	/** Resume a previous run: skip the initial /search and go straight to /next from this item */
	startAfterId?: string;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	maxAttempts?: number;
};

/**
 * Pages through CAPI in oldest-first order using the /next endpoint, which is
 * stable over deep pagination (unlike page=N). An initial /search query starts
 * the run, then /content/{lastSeenId}/next is used until a short page is returned.
 *
 * @see https://github.com/guardian/content-api/pull/2812
 */
export async function* paginateCapi(
	options: PaginateOptions,
): AsyncGenerator<Page> {
	const query = new URLSearchParams({
		...options.params,
		'page-size': String(options.pageSize),
		'order-by': 'oldest',
		'api-key': options.apiKey,
	});

	let lastSeenId = options.startAfterId;
	let complete = false;
	while (!complete) {
		const path =
			lastSeenId === undefined ? 'search' : `content/${lastSeenId}/next`;
		const url = `${options.baseUrl}/${path}?${query.toString()}`;
		const { results, total } = await fetchPage(url, options);

		yield { results, total, url: redact(url) };

		complete = results.length < options.pageSize;
		lastSeenId = results.at(-1)?.id;
	}
}

async function fetchPage(
	url: string,
	{
		fetch: fetchFn = fetch,
		sleep = defaultSleep,
		maxAttempts = 5,
	}: PaginateOptions,
): Promise<z.infer<typeof CapiResponse>['response']> {
	for (let attempt = 1; ; attempt++) {
		let error: string;
		try {
			const response = await fetchFn(url);
			if (response.ok) {
				return CapiResponse.parse(await response.json()).response;
			}
			if (!isRetryable(response.status)) {
				throw new Error(`HTTP ${response.status} from ${redact(url)}`);
			}
			error = `HTTP ${response.status}`;
		} catch (e) {
			// fetch reports network failures as TypeErrors; anything else is fatal
			if (!(e instanceof TypeError)) {
				throw e;
			}
			error = e.message;
		}
		if (attempt >= maxAttempts) {
			throw new Error(
				`Giving up on ${redact(url)} after ${attempt} attempts: ${error}`,
			);
		}
		const delayMs = 2 ** attempt * 500;
		console.warn(
			`Attempt ${attempt} failed (${error}), retrying in ${delayMs}ms`,
		);
		await sleep(delayMs);
	}
}

const isRetryable = (status: number) => status === 429 || status >= 500;

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

const redact = (url: string) => url.replace(/api-key=[^&]*/, 'api-key=***');
