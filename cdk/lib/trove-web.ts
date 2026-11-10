import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuS3Bucket } from '@guardian/cdk/lib/constructs/s3/index.js';
import type { App } from 'aws-cdk-lib';
import { CfnOutput, Duration, Tags } from 'aws-cdk-lib';
import {
	ManagedPolicy,
	PolicyStatement,
	Role,
	ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
	CfnWebFunction,
	CfnWebFunctionEndpoint,
	CfnWebFunctionRevision,
} from 'aws-cdk-lib/aws-lambda';
import { BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { WebFunctionHealthcheck } from './web-healthcheck.ts';

export const troveWebApp = 'trove-web';
export const troveWebFileName = 'trove-web.zip';

export function troveWebArtifactBucketSsmKey(stage: string): string {
	return `/${stage}/content-api/${troveWebApp}/artifact-bucket`;
}

function troveWebFunctionName(stage: string): string {
	return `${troveWebApp}-${stage}`;
}

/**
 * Lambda Web Functions can only load code from a versioned S3 bucket whose
 * policy grants the Lambda service principal read access, which the shared
 * Riff-Raff artifact bucket doesn't provide.
 *
 * This lives in its own stack so that the bucket exists before Riff-Raff
 * uploads the first artifact to it.
 */
export class TroveWebArtifacts extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const bucket = new GuS3Bucket(this, 'ArtifactBucket', {
			app: troveWebApp,
			versioned: true,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			enforceSSL: true,
			lifecycleRules: [
				{
					// Revisions pin an object version and fail permanently if it is deleted,
					// so keep enough history to roll back to recent builds.
					noncurrentVersionExpiration: Duration.days(30),
					noncurrentVersionsToRetain: 10,
				},
			],
		});

		bucket.addToResourcePolicy(
			new PolicyStatement({
				principals: [new ServicePrincipal('lambda.amazonaws.com')],
				actions: ['s3:GetObject', 's3:GetObjectVersion'],
				resources: [bucket.arnForObjects('*')],
				conditions: {
					ArnLike: {
						'aws:SourceArn': `arn:aws:lambda:${this.region}:${this.account}:web-function/${troveWebFunctionName(this.stage)}/revision/*`,
					},
				},
			}),
		);

		new StringParameter(this, 'ArtifactBucketName', {
			parameterName: troveWebArtifactBucketSsmKey(this.stage),
			stringValue: bucket.bucketName,
		});
	}
}

export interface TroveWebProps extends GuStackProps {
	/**
	 * Identifies the build being deployed. Every revision property forces a
	 * replacement, so a new value creates a new revision on each deploy.
	 */
	buildId: string;
}

export class TroveWeb extends GuStack {
	constructor(scope: App, id: string, props: TroveWebProps) {
		super(scope, id, props);

		const functionName = troveWebFunctionName(this.stage);

		const role = new Role(this, 'ExecutionRole', {
			assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
			managedPolicies: [
				ManagedPolicy.fromAwsManagedPolicyName(
					'service-role/AWSLambdaBasicExecutionRole',
				),
			],
		});

		const webFunction = new CfnWebFunction(this, 'WebFunction', {
			functionName,
		});
		Tags.of(webFunction).add('App', troveWebApp);

		const revision = new CfnWebFunctionRevision(this, 'Revision', {
			functionName: webFunction.ref,
			description: `Build ${props.buildId}`,
			buildConfig: {
				codeConfig: {
					s3Object: {
						bucket: StringParameter.valueForStringParameter(
							this,
							troveWebArtifactBucketSsmKey(this.stage),
						),
						// Matches the key Riff-Raff's uploadLambda action writes to.
						// With no versionId, Lambda pins the latest object version.
						key: `${this.stack}/${this.stage}/${troveWebApp}/${troveWebFileName}`,
					},
				},
				runtimeConfig: { runtime: 'nodejs24.x' },
			},
			serviceConfig: {
				executionRoleArn: role.roleArn,
				timeoutSeconds: 30,
				environmentVariables: { BUILD_ID: props.buildId },
			},
		});
		const revisionWeights = [
			{ revisionId: revision.attrRevisionId, weight: 100 },
		];

		// Each new revision goes to the candidate endpoint first. The main endpoint
		// only moves to it once the healthcheck passes; otherwise the stack rolls back.
		const candidateEndpoint = new CfnWebFunctionEndpoint(
			this,
			'CandidateEndpoint',
			{
				functionName: webFunction.ref,
				endpointName: `${troveWebApp}-candidate`,
				endpointType: 'HomeRegion',
				authType: 'ApplicationManaged',
				revisionWeights,
			},
		);

		const healthcheck = new WebFunctionHealthcheck(this, 'Healthcheck', {
			url: `https://${candidateEndpoint.attrDomainName}/healthcheck`,
			buildId: props.buildId,
		});

		const endpoint = new CfnWebFunctionEndpoint(this, 'Endpoint', {
			functionName: webFunction.ref,
			endpointName: troveWebApp,
			endpointType: 'HomeRegion',
			authType: 'ApplicationManaged',
			revisionWeights,
		});
		endpoint.node.addDependency(healthcheck.resource);

		new CfnOutput(this, 'EndpointDomainName', {
			value: endpoint.attrDomainName,
		});
	}
}
