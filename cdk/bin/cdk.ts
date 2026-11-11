import { GuRoot } from '@guardian/cdk/lib/constructs/root.js';
import { TroveOpenSearch } from '../lib/trove-open-search.ts';
import { Trove } from '../lib/trove.ts';

// Set by CI after pushing the trove-backfill-ecs image to ECR.
const backfillImageDigest = process.env.IMAGE_DIGEST;
if (!backfillImageDigest) {
	throw new Error(
		'IMAGE_DIGEST must be set to the trove-backfill-ecs image digest',
	);
}

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
