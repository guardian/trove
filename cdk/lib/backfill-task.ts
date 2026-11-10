import type { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuDistributionBucketParameter } from '@guardian/cdk/lib/constructs/core/index.js';
import {
	GuHttpsEgressSecurityGroup,
	GuVpc,
	SubnetType,
} from '@guardian/cdk/lib/constructs/ec2/index.js';
import { GuEcsTask } from '@guardian/cdk/lib/constructs/ecs/index.js';
import type { RiffRaffYamlFile } from '@guardian/cdk/lib/riff-raff-yaml-file/index.js';
import { UnknownRiffRaffProjectName } from '@guardian/cdk/lib/riff-raff-yaml-file/types.js';
import { ContainerInsights } from 'aws-cdk-lib/aws-ecs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { JsonPath } from 'aws-cdk-lib/aws-stepfunctions';

/**
 * Must match the workflow's contentDirectories key, the uploaded ZIP name
 * (`<app>.zip`) and the S3 path the task downloads from.
 */
export const backfillTaskApp = 'trove-backfill-task';

/**
 * The container's root filesystem is read-only, so the task downloads and
 * runs its code from a writable volume mounted here.
 */
const workingDirectory = '/usr/src/trove';

/**
 * An off-the-shelf public image with Node, the AWS CLI and unzip, standing in for
 * the custom base image that Lurch builds and pushes to ECR. It's ~3GB, but the
 * pull time is negligible relative to a long-running backfill.
 * Node 24 matches the Lambda runtime used elsewhere in this repo.
 */
const containerImage = 'public.ecr.aws/sam/build-nodejs24.x:1.171.0';

/**
 * A long-running CAPI pagination loop, run on Fargate and wrapped in a Step
 * Function (by GuEcsTask) so it can be started with input and alarmed on.
 *
 * Following Lurch, the image is generic and the task's code is deployed by
 * Riff-Raff to the dist bucket as a ZIP, then fetched when the task starts.
 */
export function addBackfillTask(
	scope: GuStack,
	alarmTopic: ITopic | undefined,
): GuEcsTask {
	const app = backfillTaskApp;
	const { stack, stage } = scope;
	const distBucket =
		GuDistributionBucketParameter.getInstance(scope).valueAsString;
	const capiApiKeyParameter = `/${stage}/${stack}/${app}/capiApiKey`;

	const taskCommand = [
		`cd ${workingDirectory}`,
		`aws s3 cp s3://${distBucket}/${stack}/${stage}/${app}/${app}.zip .`,
		`unzip -o ${app}.zip`,
		// Assignment (rather than `export X=$(...)`) so that a failed lookup fails the command
		`CAPI_API_KEY=$(aws ssm get-parameter --with-decryption --name ${capiApiKeyParameter} --query Parameter.Value --output text)`,
		'export CAPI_API_KEY',
		'node index.js',
	].join(' && ');

	const vpc = GuVpc.fromIdParameter(scope, 'VPC');

	const task = new GuEcsTask(scope, 'TroveBackfillTask', {
		app,
		vpc,
		// Fixed number rather than subnetsFromParameter, see https://github.com/guardian/cdk/pull/2477
		subnets: GuVpc.subnetsFromParameterFixedNumber(
			scope,
			{ type: SubnetType.PRIVATE, app },
			3,
		),
		containerConfiguration: { type: 'registry', id: containerImage },
		taskCommand,
		// The work is I/O bound, so the smallest Fargate size will do
		cpu: 256,
		memory: 512,
		taskTimeoutInMinutes: 24 * 60,
		monitoringConfiguration: alarmTopic
			? { noMonitoring: false, snsTopicArn: alarmTopic.topicArn }
			: { noMonitoring: true },
		containerInsights: ContainerInsights.DISABLED,
		// Without this the VPC's default security group is used, which typically allows no egress
		securityGroups: [GuHttpsEgressSecurityGroup.forVpc(scope, { app, vpc })],
		customTaskPolicies: [
			new PolicyStatement({
				actions: ['ssm:GetParameter'],
				resources: [
					`arn:aws:ssm:${scope.region}:${scope.account}:parameter${capiApiKeyParameter}`,
				],
			}),
		],
		// Pass the whole Step Function execution input through, so all fields are optional
		environmentOverrides: [
			{
				name: 'BACKFILL_INPUT',
				value: JsonPath.jsonToString(JsonPath.objectAt('$')),
			},
		],
	});

	task.containerDefinition.addEnvironment('AWS_REGION', scope.region);

	const volume = { name: `${app}-volume` };
	task.taskDefinition.addVolume(volume);
	task.containerDefinition.addMountPoints({
		sourceVolume: volume.name,
		containerPath: workingDirectory,
		readOnly: false,
	});

	return task;
}

/**
 * GuCDK only generates Riff-Raff deployments for Lambdas, EC2 apps and
 * CloudFormation, so add an `aws-s3` deployment that uploads the task's ZIP to
 * `<dist bucket>/<stack>/<stage>/<app>/`, where the task fetches it from.
 */
export function addBackfillTaskDeployment(
	riffRaff: RiffRaffYamlFile,
	stacks: GuStack[],
): void {
	const config = riffRaff.configuration.get(UnknownRiffRaffProjectName);
	if (!config) {
		throw new Error('No riff-raff.yaml configuration found');
	}
	config.deployments.set(backfillTaskApp, {
		type: 'aws-s3',
		app: backfillTaskApp,
		contentDirectory: backfillTaskApp,
		regions: new Set(stacks.map((s) => s.region)),
		stacks: new Set(stacks.map((s) => s.stack)),
		parameters: {
			// Same SSM key as GuCDK's DistributionBucketName parameter
			bucketSsmLookup: true,
			cacheControl: 'private',
			publicReadAcl: false,
		},
	});
}
