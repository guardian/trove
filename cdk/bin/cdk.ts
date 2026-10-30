import { GuRoot } from '@guardian/cdk/lib/constructs/root.js';
import { TroveOpenSearch } from '../lib/trove-open-search.ts';
import { Trove } from '../lib/trove.ts';

const app = new GuRoot();
new Trove(app, 'Trove-euwest-1-CODE', {
	stack: 'content-api',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
});
new Trove(app, 'Trove-euwest-1-PROD', {
	stack: 'content-api',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
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
