import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import {
	GuHttpsEgressSecurityGroup,
	GuVpc,
	SubnetType,
} from '@guardian/cdk/lib/constructs/ec2/index.js';
import type { App } from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import {
	BlockDeviceVolume,
	EbsDeviceVolumeType,
	InstanceClass,
	InstanceSize,
	InstanceType,
	LaunchTemplate,
	UserData,
} from 'aws-cdk-lib/aws-ec2';
import {
	AmiHardwareType,
	AsgCapacityProvider,
	Cluster,
	ContainerImage,
	ContainerInsights,
	Ec2Service,
	Ec2TaskDefinition,
	EcsOptimizedImage,
	IpcMode,
	LogDrivers,
	NetworkMode,
} from 'aws-cdk-lib/aws-ecs';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

const app = 'trove-qwen-embedding';
const model = 'Qwen/Qwen3-VL-Embedding-8B';
const port = 8000;
// Qwen3-VL-Embedding needs vLLM >= 0.14. Pinned by digest so deploys are reproducible.
const vllmImage =
	'vllm/vllm-openai:v0.34.0@sha256:20fdb089454afbb324efa4110a2c025ff7b27cc1a086e07aa580b18df8ad1ce1';
// Persists downloaded weights on the instance, so task restarts don't re-download about 16 GB
const hfCacheHostPath = '/var/lib/huggingface';

/**
 * Proof of concept: self-hosts Qwen3-VL-Embedding-8B with vLLM on a single GPU instance, as a possible replacement
 * for Marengo. There's no load balancer, so reach it with SSM port forwarding (see docs/qwen-embedding-poc.md).
 */
export class TroveQwenEmbedding extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);
		Tags.of(this).add('App', app);

		const vpc = GuVpc.fromIdParameter(this, 'Vpc');
		const cluster = new Cluster(this, 'Cluster', {
			vpc,
			containerInsightsV2: ContainerInsights.DISABLED,
		});

		// Fargate has no GPUs, so run on EC2. We use a plain ASG because GuAutoScalingGroup requires an AMIgo image,
		// and the ECS GPU-optimised AMI already has the NVIDIA driver and container toolkit.
		const launchTemplate = new LaunchTemplate(this, 'LaunchTemplate', {
			// 1x NVIDIA L4 (24 GB). The bf16 weights are about 16 GB, leaving room for the KV cache.
			instanceType: InstanceType.of(InstanceClass.G6, InstanceSize.XLARGE),
			machineImage: EcsOptimizedImage.amazonLinux2023(AmiHardwareType.GPU),
			// The capacity provider adds the ECS cluster config to this
			userData: UserData.forLinux(),
			role: new Role(this, 'InstanceRole', {
				assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
				// For SSM port forwarding to the vLLM port
				managedPolicies: [
					ManagedPolicy.fromAwsManagedPolicyName(
						'AmazonSSMManagedInstanceCore',
					),
				],
			}),
			requireImdsv2: true,
			securityGroup: new GuHttpsEgressSecurityGroup(this, 'SecurityGroup', {
				app,
				vpc,
			}),
			blockDevices: [
				{
					// Room for the vLLM image (about 10 GB compressed) and the model weights
					deviceName: '/dev/xvda',
					volume: BlockDeviceVolume.ebs(150, {
						volumeType: EbsDeviceVolumeType.GP3,
						encrypted: true,
					}),
				},
			],
		});

		const asg = new AutoScalingGroup(this, 'Asg', {
			vpc,
			vpcSubnets: {
				subnets: GuVpc.subnetsFromParameterFixedNumber(this, {
					type: SubnetType.PRIVATE,
					app,
				}),
			},
			launchTemplate,
			minCapacity: 0,
			maxCapacity: 1,
		});

		// Managed scaling launches the instance when the service wants a task, and removes it when it doesn't
		const capacityProvider = new AsgCapacityProvider(this, 'CapacityProvider', {
			autoScalingGroup: asg,
			enableManagedTerminationProtection: false,
		});
		cluster.addAsgCapacityProvider(capacityProvider);

		const taskDefinition = new Ec2TaskDefinition(this, 'TaskDefinition', {
			// The container listens on the instance's own port, so SSM port forwarding to the instance reaches it
			networkMode: NetworkMode.HOST,
			// PyTorch uses shared memory, and the Docker default of 64 MB is too small
			ipcMode: IpcMode.HOST,
			volumes: [{ name: 'hf-cache', host: { sourcePath: hfCacheHostPath } }],
		});

		const container = taskDefinition.addContainer('vllm', {
			image: ContainerImage.fromRegistry(vllmImage),
			// The image's entrypoint is `vllm serve`
			command: [
				model,
				'--runner',
				'pooling',
				'--dtype',
				'bfloat16',
				// Our inputs are headlines and standfirsts, so a short context leaves more GPU memory for batching
				'--max-model-len',
				'8192',
				'--port',
				String(port),
			],
			gpuCount: 1,
			// g6.xlarge has 16 GiB. Leave some for the ECS agent and OS.
			memoryReservationMiB: 12 * 1024,
			portMappings: [{ containerPort: port }],
			healthCheck: {
				command: [
					'CMD-SHELL',
					`python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${port}/health')"`,
				],
				// The first start pulls the image and downloads the weights, so allow about 15 minutes
				startPeriod: Duration.minutes(5),
				interval: Duration.minutes(1),
				retries: 10,
			},
			logging: LogDrivers.awsLogs({
				streamPrefix: app,
				logGroup: new LogGroup(this, 'LogGroup', {
					retention: RetentionDays.ONE_WEEK,
					removalPolicy: RemovalPolicy.DESTROY,
				}),
			}),
		});
		container.addMountPoints({
			sourceVolume: 'hf-cache',
			containerPath: '/root/.cache/huggingface',
			readOnly: false,
		});

		new Ec2Service(this, 'Service', {
			cluster,
			taskDefinition,
			// Set to 0 to stop the task. Managed scaling then terminates the GPU instance.
			desiredCount: 1,
			// The only instance is replaced on deploy, so the old task must stop first
			minHealthyPercent: 0,
			maxHealthyPercent: 100,
			capacityProviderStrategies: [
				{ capacityProvider: capacityProvider.capacityProviderName, weight: 1 },
			],
			enableExecuteCommand: true,
		});
	}
}
