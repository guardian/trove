/**
 * Local only: seeds docker-compose OpenSearch with a few documents with random
 * embeddings, then runs a sample kNN search. Fixed ids make it safe to re-run.
 *
 *   npm run seed-local -w datastore   (or ./scripts/setup.sh from the repo root)
 */
import { ArticleV1 } from '../src/article.ts';
import { createClient } from '../src/client.ts';
import { articleAliases, resolveWriteIndices } from '../src/indices.ts';
import { embeddingModels } from '../src/open-search-embeddings.ts';

if (process.env.OPENSEARCH_ENDPOINT) {
	throw new Error(
		'seed-local writes fake articles, so refuses to run against AWS',
	);
}

const client = createClient();

const randomVector = () =>
	Array.from(
		{ length: embeddingModels.marengo_3_0.dimension },
		() => Math.random() * 2 - 1,
	);

const embedded = (value: string) => ({
	value,
	embeddings: { marengo_3_0: randomVector() },
});

const article = (
	headline: string,
	standfirst: string,
	keywordTagIds: string[],
) =>
	ArticleV1.parse({
		headline: embedded(headline),
		standfirst: embedded(standfirst),
		headlineAndStandfirst: embedded(`${headline}\n${standfirst}`),
		keywordTagIds,
		internalRevision: Math.floor(Math.random() * 10_000),
		storedAt: new Date().toISOString(),
	});

const samples: Record<string, ArticleV1> = {
	'world/2026/oct/26/lula-wins-brazil-election': article(
		'Lula wins Brazil election',
		'Incumbent secures another term after a tight run-off',
		['world/brazil', 'world/luiz-inacio-lula-da-silva'],
	),
	'food/2026/oct/20/cucumber-salad-recipe': article(
		'The only cucumber salad you need',
		'Crunchy, sharp and ready in ten minutes',
		['food/cucumber', 'food/salad'],
	),
	'sport/2026/oct/25/premier-league-roundup': article(
		'Premier League roundup',
		'All the goals and talking points from the weekend',
		['sport/premierleague', 'football/football'],
	),
};

for (const alias of Object.values(articleAliases)) {
	if (!(await client.indices.existsAlias({ name: alias })).body) {
		throw new Error(`Alias "${alias}" is missing, run apply-schema first`);
	}
}

const writeIndices = await resolveWriteIndices(client);
const { body: bulk } = await client.bulk({
	refresh: true,
	body: writeIndices.flatMap((index) =>
		Object.entries(samples).flatMap(([id, doc]) => [
			{ index: { _index: index, _id: id } },
			doc,
		]),
	),
});
if (bulk.errors) {
	throw new Error(JSON.stringify(bulk.items, null, 2));
}
console.log(
	`Indexed ${bulk.items.length} documents into ${writeIndices.join(', ')}`,
);

// Embeddings are excluded from search results, so parse with a schema that omits them
const textOnly = ArticleV1.shape.headline.omit({ embeddings: true });
const SearchHit = ArticleV1.extend({
	headline: textOnly,
	standfirst: textOnly,
	headlineAndStandfirst: textOnly,
});

const { body: search } = await client.search({
	index: articleAliases.current,
	body: {
		size: 3,
		_source: { excludes: ['*.embeddings'] },
		query: {
			knn: {
				'headlineAndStandfirst.embeddings.marengo_3_0': {
					vector: randomVector(),
					k: 3,
				},
			},
		},
	},
});
for (const hit of search.hits.hits) {
	const doc = SearchHit.parse(hit._source);
	console.log(hit._score?.toFixed(3), hit._id, doc.headline.value);
}
