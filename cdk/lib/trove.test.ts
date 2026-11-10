import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, snapshot } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TroveOpenSearch } from './trove-open-search.ts';
import { TroveRoot } from './trove-root.ts';
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

void describe('TroveRoot', () => {
	void it('adds an aws-s3 deployment for the backfill task to riff-raff.yaml', (context) => {
		const outdir = mkdtempSync(join(tmpdir(), 'trove-cdk-'));
		context.after(() => rmSync(outdir, { recursive: true, force: true }));
		const app = new TroveRoot({ outdir });
		new Trove(app, 'Trove-CODE', {
			stack: 'content-api',
			stage: 'CODE',
			env: { region: 'eu-west-1' },
		});

		app.synth();

		const riffRaffYaml = readFileSync(join(outdir, 'riff-raff.yaml'), 'utf8');
		assert.ok(
			riffRaffYaml.includes(
				[
					'  trove-backfill-task:',
					'    type: aws-s3',
					'    app: trove-backfill-task',
					'    contentDirectory: trove-backfill-task',
					'    regions:',
					'      - eu-west-1',
					'    stacks:',
					'      - content-api',
				].join('\n'),
			),
			riffRaffYaml,
		);
	});
});
