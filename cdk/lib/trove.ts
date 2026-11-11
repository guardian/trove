import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuVpc, SubnetType } from '@guardian/cdk/lib/constructs/ec2/index.js';
import { GuRepository } from '@guardian/cdk/lib/constructs/ecr/repository.js';
import { GuEcsTask } from '@guardian/cdk/lib/constructs/ecs/index.js';
import { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda/index.js';
import { GuKinesisLambdaExperimental } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { StreamRetry } from '@guardian/cdk/lib/utils/lambda/event-source.js';
import type { App } from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { ContainerInsights, Secret as EcsSecret } from 'aws-cdk-lib/aws-ecs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { JsonPath } from 'aws-cdk-lib/aws-stepfunctions';

export interface TroveProps extends GuStackProps {
	/**
	 * Digest (e.g. `sha256:abc…`) of the trove-backfill-ecs image in the central ECR repository.
	 * Baked into the template, so a Riff-Raff CloudFormation deploy is all that's needed to roll out a new image.
	 */
	backfillImageDigest: string;
}

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: TroveProps) {
		super(scope, id, props);

		const alarmTopic = createAlarmTopic(this);

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
				batchSize: 1,
				maxBatchingWindow: Duration.seconds(10),
			},
		});

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
		});
		embedder.addEventSource(new SqsEventSource(liveQueue));
		embedder.addEventSource(new SqsEventSource(backfillQueue));

		// No trigger yet: invoked manually until we decide how backfill runs are driven
		const backfill = new GuLambdaFunction(this, 'TroveBackfill', {
			app: 'trove-backfill',
			fileName: 'trove-backfill.zip',
			functionName: `trove-backfill-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
		});
		backfillQueue.grantSendMessages(backfill);
		backfill.addEnvironment(
			'BACKFILL_EMBEDDER_QUEUE_URL',
			backfillQueue.queueUrl,
		);

		// PoC: backfill as a long-running Fargate task, wrapped by GuEcsTask in a Step Function.
		// Start an execution with input {"fromDate": "YYYY-MM-DD", "toDate": "YYYY-MM-DD"}.
		const backfillEcsApp = 'trove-backfill-ecs';
		const vpc = GuVpc.fromIdParameter(this, 'Vpc');
		const backfillEcs = new GuEcsTask(this, 'TroveBackfillEcs', {
			app: backfillEcsApp,
			vpc,
			subnets: GuVpc.subnetsFromParameterFixedNumber(this, {
				type: SubnetType.PRIVATE,
				app: backfillEcsApp,
			}),
			securityGroups: [
				new SecurityGroup(this, 'TroveBackfillEcsSecurityGroup', {
					vpc,
					description: 'Egress to CAPI and SQS for trove-backfill-ecs',
					allowAllOutbound: true,
				}),
			],
			containerConfiguration: {
				type: 'repository',
				repository: new GuRepository(this, 'TroveBackfillEcsRepository', {
					name: `guardian/trove/${backfillEcsApp}`,
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
			environmentOverrides: [
				{ name: 'FROM_DATE', value: JsonPath.stringAt('$.fromDate') },
				{ name: 'TO_DATE', value: JsonPath.stringAt('$.toDate') },
			],
		});
		backfillQueue.grantSendMessages(backfillEcs.taskDefinition.taskRole);
		backfillEcs.containerDefinition.addEnvironment(
			'BACKFILL_EMBEDDER_QUEUE_URL',
			backfillQueue.queueUrl,
		);
		backfillEcs.containerDefinition.addSecret(
			'CAPI_API_KEY',
			EcsSecret.fromSsmParameter(
				StringParameter.fromSecureStringParameterAttributes(
					this,
					'TroveBackfillEcsCapiApiKey',
					{
						parameterName: `/${this.stage}/${this.stack}/${backfillEcsApp}/capi-api-key`,
					},
				),
			),
		);
	}
}

function createQueueWithDLQ(scope: GuStack, id: string): Queue {
	const deadLetterQueue = new Queue(scope, `${id}DeadLetterQueue`, {
		retentionPeriod: Duration.days(14),
	});
	return new Queue(scope, `${id}Queue`, {
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
