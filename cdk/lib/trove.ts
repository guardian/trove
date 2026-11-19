import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import {
	GuHttpsEgressSecurityGroup,
	GuVpc,
	SubnetType,
} from '@guardian/cdk/lib/constructs/ec2/index.js';
import { GuRepository } from '@guardian/cdk/lib/constructs/ecr/repository.js';
import { GuEcsTask } from '@guardian/cdk/lib/constructs/ecs/index.js';
import { GuDeveloperPolicy } from '@guardian/cdk/lib/constructs/iam/policies/developer-policy.js';
import { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda/index.js';
import { GuKinesisLambdaExperimental } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { StreamRetry } from '@guardian/cdk/lib/utils/lambda/event-source.js';
import type { App } from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { ContainerInsights } from 'aws-cdk-lib/aws-ecs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
	grantOpenSearchWrite,
	openSearchApiCallStatement,
} from './trove-open-search-access.ts';

export interface TroveProps extends GuStackProps {
	/**
	 * Digest (e.g. `sha256:abc…`) of the trove-backfill image in the central ECR repository.
	 * Baked into the template, so a Riff-Raff CloudFormation deploy is all that's needed to roll out a new image.
	 */
	backfillImageDigest: string;
}

const marengoInvokeStatement = new PolicyStatement({
	effect: Effect.ALLOW,
	actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
	resources: [
		'arn:aws:bedrock:eu-west-1:308506855511:inference-profile/eu.twelvelabs.marengo-embed-3-0-v1:0',
		'arn:aws:bedrock:*::foundation-model/twelvelabs.marengo-embed-3-0-v1:0',
	],
});

// Lambda's recommendation: at least 6x the function timeout, so retries don't overlap
const embedderTimeout = Duration.seconds(60);
const embedderQueueVisibilityTimeout = Duration.seconds(
	embedderTimeout.toSeconds() * 6,
);

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: TroveProps) {
		super(scope, id, props);

		const alarmTopic = createAlarmTopic(this);
		if (['CODE', 'TEST'].includes(this.stage)) {
			new GuDeveloperPolicy(this, 'TroveLocalRunPolicy', {
				grantId: 'newsroom-ai-trove-local-run',
				friendlyName: 'Run Trove locally',
				withoutPolicyChecks: true,
				statements: [marengoInvokeStatement, openSearchApiCallStatement(this)],
			});
		}

		// Resolved at runtime by the apps rather than baked into the template
		const capiApiKey = StringParameter.fromStringParameterName(
			this,
			'TroveCapiApiKey',
			`/${this.stage}/${this.stack}/trove/capi-key`,
		);

		const listener = new GuKinesisLambdaExperimental(this, 'TroveListener', {
			app: 'trove-listener',
			fileName: 'trove-listener.zip',
			functionName: `trove-listener-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
			monitoringConfiguration: alarmTopic
				? { snsTopicName: alarmTopic.topicName, toleratedErrorPercentage: 0 }
				: { noMonitoring: true },
			errorHandlingConfiguration: {
				retryBehaviour: StreamRetry.maxAttempts(3),
				bisectBatchOnError: true,
			},
			existingKinesisStream: {
				externalKinesisStreamName: `content-api-firehose-v2-${this.stage}`,
			},
			processingProps: {
				startingPosition: StartingPosition.LATEST,
				// Matches the SQS SendMessageBatch limit, so each Kinesis batch is a single SQS request
				batchSize: 10,
				maxBatchingWindow: Duration.seconds(10),
			},
		});

		capiApiKey.grantRead(listener);
		listener.addEnvironment('CAPI_API_KEY_PARAMETER', capiApiKey.parameterName);

		const liveQueue = createQueueWithDLQ(this, 'EmbedderLive');
		const backfillQueue = createQueueWithDLQ(this, 'EmbedderBackfill');

		liveQueue.grantSendMessages(listener);
		listener.addEnvironment('LIVE_EMBEDDER_QUEUE_URL', liveQueue.queueUrl);

		// A single function fed by both queues, so throughput can be throttled at the function level
		const embedder = new GuLambdaFunction(this, 'TroveEmbedder', {
			app: 'trove-embedder',
			fileName: 'trove-embedder.zip',
			functionName: `trove-embedder-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
			timeout: embedderTimeout,
		});
		embedder.addToRolePolicy(marengoInvokeStatement);
		// Failed messages are reported individually, so only they are retried
		embedder.addEventSource(
			new SqsEventSource(liveQueue, { reportBatchItemFailures: true }),
		);
		embedder.addEventSource(
			new SqsEventSource(backfillQueue, { reportBatchItemFailures: true }),
		);
		grantOpenSearchWrite(this, embedder);

		// Backfill is a long-running Fargate task, wrapped by GuEcsTask in a Step Function.
		const backfillApp = 'trove-backfill';
		const vpc = GuVpc.fromIdParameter(this, 'Vpc');
		const backfill = new GuEcsTask(this, 'TroveBackfill', {
			app: backfillApp,
			vpc,
			subnets: GuVpc.subnetsFromParameterFixedNumber(this, {
				type: SubnetType.PRIVATE,
				app: backfillApp,
			}),
			// Outbound HTTPS only, which covers CAPI, SQS, ECR, SSM and CloudWatch Logs. Same as GuLoadBalancedApp:
			// https://github.com/guardian/cdk/blob/3781e814e4cc37bfa3c8c317f9d8dc316dc6b734/src/experimental/patterns/gu-load-balanced-app.ts#L770-L773
			securityGroups: [
				new GuHttpsEgressSecurityGroup(this, 'TroveBackfillSecurityGroup', {
					app: backfillApp,
					vpc,
				}),
			],
			containerConfiguration: {
				type: 'repository',
				repository: new GuRepository(this, 'TroveBackfillRepository', {
					name: `guardian/trove/${backfillApp}`,
				}),
				version: props.backfillImageDigest,
			},
			cpu: 256,
			memory: 512,
			taskTimeoutInMinutes: 7 * 24 * 60,
			enableDistributablePolicy: false,
			containerInsights: ContainerInsights.DISABLED,
			monitoringConfiguration: alarmTopic
				? { noMonitoring: false, snsTopicArn: alarmTopic.topicArn }
				: { noMonitoring: true },
		});
		backfillQueue.grantSendMessages(backfill.taskDefinition.taskRole);
		backfill.containerDefinition.addEnvironment(
			'BACKFILL_EMBEDDER_QUEUE_URL',
			backfillQueue.queueUrl,
		);
		capiApiKey.grantRead(backfill.taskDefinition.taskRole);
		backfill.containerDefinition.addEnvironment(
			'CAPI_API_KEY_PARAMETER',
			capiApiKey.parameterName,
		);
	}
}

function createQueueWithDLQ(scope: GuStack, id: string): Queue {
	const deadLetterQueue = new Queue(scope, `${id}DeadLetterQueue`, {
		retentionPeriod: Duration.days(14),
	});
	return new Queue(scope, `${id}Queue`, {
		visibilityTimeout: embedderQueueVisibilityTimeout,
		deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 3 },
	});
}

function createAlarmTopic(scope: GuStack): Topic | undefined {
	if (!['PROD', 'TEST'].includes(scope.stage)) {
		return undefined;
	}
	const alarmSnsTopic = new Topic(scope, `trove-email-alarm-topic`);
	alarmSnsTopic.addSubscription(
		new EmailSubscription('ai.dev+alerts@guardian.co.uk'),
	);
	return alarmSnsTopic;
}
