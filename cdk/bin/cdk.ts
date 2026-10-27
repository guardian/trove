import { GuRoot } from '@guardian/cdk/lib/constructs/root.js';
import { Trove } from '../lib/trove.ts';

const app = new GuRoot();
new Trove(app, 'Trove-euwest-1-CODE', {
	stack: 'capi',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
});
new Trove(app, 'Trove-euwest-1-PROD', {
	stack: 'capi',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
});
