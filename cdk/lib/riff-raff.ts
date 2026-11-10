import type { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { RiffRaffYamlFile } from '@guardian/cdk/lib/riff-raff-yaml-file/index.js';
import type { RiffRaffDeployments } from '@guardian/cdk/lib/riff-raff-yaml-file/types.js';
import type { StageSynthesisOptions } from 'aws-cdk-lib';
import { App } from 'aws-cdk-lib';
import type { CloudAssembly } from 'aws-cdk-lib/cx-api';
import {
	TroveWeb,
	troveWebApp,
	troveWebArtifactBucketSsmKey,
	troveWebFileName,
} from './trove-web.ts';

/**
 * GuCDK knows how to upload and update `GuLambdaFunction`s, but not Lambda Web
 * Functions, whose code can only change by creating a new revision. For these
 * we upload the artifact with Riff-Raff and let CloudFormation create the
 * revision, so the web stack's deployment must wait for the upload.
 */
export function addTroveWebUploads(
	deployments: RiffRaffDeployments,
	webStacks: GuStack[],
): void {
	const cfnDeployments = [...deployments.entries()].filter(
		([, { type, app }]) => type === 'cloud-formation' && app === troveWebApp,
	);

	for (const [cfnName, cfnProps] of cfnDeployments) {
		const [region] = [...cfnProps.regions];
		const [stack] = [...cfnProps.stacks];
		if (!region || !stack) {
			throw new Error(`Cannot determine region and stack for ${cfnName}`);
		}

		const uploadName = ['lambda-upload', region, stack, troveWebApp].join('-');
		const stages = webStacks
			.filter((s) => s.region === region && s.stack === stack)
			.map((s) => s.stage);

		deployments.set(uploadName, {
			type: 'aws-lambda',
			regions: new Set([region]),
			stacks: new Set([stack]),
			app: troveWebApp,
			contentDirectory: troveWebApp,
			parameters: {
				bucketSsmKeyStageParam: Object.fromEntries(
					stages.map((stage) => [stage, troveWebArtifactBucketSsmKey(stage)]),
				),
				// Only used to build the S3 key (stack/stage/app/fileName); no function is looked up on upload.
				lookupByTags: true,
				fileName: troveWebFileName,
			},
			actions: ['uploadLambda'],
			// The artifact bucket is created by the parent (artifacts) stack.
			dependencies: cfnProps.dependencies ?? [],
		});

		cfnProps.dependencies = [...(cfnProps.dependencies ?? []), uploadName];
	}
}

/** Like GuCDK's `GuRoot`, with extra Riff-Raff deployments for Lambda Web Functions. */
export class TroveRoot extends App {
	override synth(options?: StageSynthesisOptions): CloudAssembly {
		const cloudAssembly = super.synth(options);
		const riffRaff = new RiffRaffYamlFile(this);
		const webStacks = this.node.children.filter(
			(child): child is TroveWeb => child instanceof TroveWeb,
		);
		riffRaff.configuration.forEach(({ deployments }) =>
			addTroveWebUploads(deployments, webStacks),
		);
		riffRaff.synth();
		return cloudAssembly;
	}
}
