import { GuRoot } from '@guardian/cdk/lib/constructs/root.js';
import { TroveOpenSearch } from '../lib/trove-open-search.ts';
import { Trove } from '../lib/trove.ts';

// Set by CI after pushing the trove-backfill image to ECR.
const backfillImageDigest = process.env.IMAGE_DIGEST;
if (!backfillImageDigest) {
	throw new Error(
		'IMAGE_DIGEST must be set to the trove-backfill image digest',
	);
}

const app = new GuRoot();

for (const stage of ['CODE', 'PROD'] as const) {
	const openSearch = new TroveOpenSearch(
		app,
		`TroveOpenSearch-euwest-1-${stage}`,
		{ stack: 'content-api', stage, env: { region: 'eu-west-1' } },
	);
	const trove = new Trove(app, `Trove-euwest-1-${stage}`, {
		stack: 'content-api',
		stage,
		env: { region: 'eu-west-1' },
		backfillImageDigest,
	});
	// Trove reads the collection's SSM parameters at deploy time, so Riff-Raff must deploy TroveOpenSearch first
	trove.addStackDependency(openSearch);
}
