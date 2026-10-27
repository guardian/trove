import { describe, it, snapshot } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TroveOpenSearch } from './trove-open-search.ts';
import { Trove } from './trove.ts';

/** Normalise the 'gu:cdk:version' field if present, for consistent snapshots across version updates
 * @see https://github.com/guardian/cdk/blob/main/docs/best-practices.md#mocking-gucdkversion
 */
snapshot.setDefaultSnapshotSerializers([
	(value: unknown) =>
		JSON.stringify(
			value,
			(key, entry: unknown) => (key === 'gu:cdk:version' ? 'TEST' : entry),
			2,
		),
]);

void describe('The Trove stack', () => {
	void it('matches the snapshot', (context) => {
		const app = new App();
		const stack = new Trove(app, 'Trove', { stack: 'capi', stage: 'TEST' });
		const template = Template.fromStack(stack);

		context.assert.snapshot(template.toJSON());
	});
});

void describe('The TroveOpenSearch stack', () => {
	void it('matches the snapshot', (context) => {
		const app = new App();
		const stack = new TroveOpenSearch(app, 'TroveOpenSearch', {
			stack: 'capi',
			stage: 'CODE',
		});
		const template = Template.fromStack(stack);

		context.assert.snapshot(template.toJSON());
	});
});
