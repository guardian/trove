import { GuRoot } from '@guardian/cdk/lib/constructs/root.js';
import { TroveOpenSearch } from '../lib/trove-open-search.ts';
import { TroveQwenEmbedding } from '../lib/trove-qwen-embedding.ts';
import { Trove } from '../lib/trove.ts';

// Set by CI after pushing each image to ECR
function getImageDigest(envVar: string, app: string): string {
	const digest = process.env[envVar];
	if (!digest) {
		throw new Error(`${envVar} must be set to the ${app} image digest`);
	}
	return digest;
}
const backfillImageDigest = getImageDigest(
	'BACKFILL_IMAGE_DIGEST',
	'trove-backfill',
);
const qwenEmbeddingImageDigest = getImageDigest(
	'QWEN_EMBEDDING_IMAGE_DIGEST',
	'trove-qwen-embedding',
);

const app = new GuRoot();
new Trove(app, 'Trove-euwest-1-CODE', {
	stack: 'content-api',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
	backfillImageDigest,
});
new Trove(app, 'Trove-euwest-1-PROD', {
	stack: 'content-api',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
	backfillImageDigest,
});
new TroveOpenSearch(app, 'TroveOpenSearch-euwest-1-CODE', {
	stack: 'content-api',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
});
new TroveOpenSearch(app, 'TroveOpenSearch-euwest-1-PROD', {
	stack: 'content-api',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
});
new TroveQwenEmbedding(app, 'TroveQwenEmbedding-euwest-1-CODE', {
	stack: 'content-api',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
	imageDigest: qwenEmbeddingImageDigest,
});
new TroveQwenEmbedding(app, 'TroveQwenEmbedding-euwest-1-PROD', {
	stack: 'content-api',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
	imageDigest: qwenEmbeddingImageDigest,
});
