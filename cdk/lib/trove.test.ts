import { describe, it } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Trove } from './trove.ts';

void describe('The Trove stack', () => {
	void it('matches the snapshot', (context) => {
		const app = new App();
		const stack = new Trove(app, 'Trove', { stack: 'capi', stage: 'TEST' });
		const template = Template.fromStack(stack);
		context.assert.snapshot(template.toJSON(), {
			serializers: [
				(value: unknown) =>
					JSON.stringify(
						value,
						(key, entry: unknown) =>
							key === 'gu:cdk:version' ? 'TEST' : entry,
						2,
					),
			],
		});
	});
});
