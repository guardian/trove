import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RiffRaffYamlFile } from '@guardian/cdk/lib/riff-raff-yaml-file/index.js';
import { App } from 'aws-cdk-lib';
import { addTroveWebUploads } from './riff-raff.ts';
import { TroveWeb, TroveWebArtifacts } from './trove-web.ts';

void describe('addTroveWebUploads', () => {
	void it('uploads the artifact after creating the bucket and before deploying the web stack', () => {
		const app = new App();
		const env = { region: 'eu-west-1' };
		const webStacks = ['CODE', 'PROD'].map((stage) => {
			const artifacts = new TroveWebArtifacts(app, `Artifacts-${stage}`, {
				stack: 'content-api',
				stage,
				env,
			});
			const web = new TroveWeb(app, `Web-${stage}`, {
				stack: 'content-api',
				stage,
				env,
				buildId: 'TEST',
			});
			web.addStackDependency(artifacts);
			return web;
		});
		app.synth();

		const [config] = [...new RiffRaffYamlFile(app).configuration.values()];
		assert.ok(config);
		const { deployments } = config;
		addTroveWebUploads(deployments, webStacks);

		const upload = deployments.get(
			'lambda-upload-eu-west-1-content-api-trove-web',
		);
		assert.ok(upload);
		assert.deepEqual(upload.dependencies, [
			'cfn-eu-west-1-content-api-trove-web-artifacts',
		]);
		assert.deepEqual(upload.parameters.bucketSsmKeyStageParam, {
			CODE: '/CODE/content-api/trove-web/artifact-bucket',
			PROD: '/PROD/content-api/trove-web/artifact-bucket',
		});
		assert.deepEqual(
			deployments.get('cfn-eu-west-1-content-api-trove-web')?.dependencies,
			[
				'cfn-eu-west-1-content-api-trove-web-artifacts',
				'lambda-upload-eu-west-1-content-api-trove-web',
			],
		);
	});
});
