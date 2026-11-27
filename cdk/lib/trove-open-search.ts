import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import type { App } from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { CfnCollectionGroupProps } from 'aws-cdk-lib/aws-opensearchserverless';
import {
	CfnAccessPolicy,
	CfnCollection,
	CfnCollectionGroup,
	CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import { CfnApplication } from 'aws-cdk-lib/aws-opensearchservice';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export const collectionName = (stage: string) => `trove-${stage.toLowerCase()}`;

/** SSM parameters through which the Trove stack finds the collection, as its endpoint has a random id. */
export const openSearchParameterNames = (stage: string) => ({
	endpoint: `/${stage}/content-api/trove/opensearch/endpoint`,
	collectionArn: `/${stage}/content-api/trove/opensearch/collection-arn`,
});

type CapacityLimits = NonNullable<CfnCollectionGroupProps['capacityLimits']>;

// Scale to zero when idle; the max is a cost cap
const capacityLimitsByStage: Record<'CODE' | 'PROD', CapacityLimits> = {
	CODE: {
		minIndexingCapacityInOcu: 0,
		minSearchCapacityInOcu: 0,
		maxIndexingCapacityInOcu: 4,
		maxSearchCapacityInOcu: 4,
	},
	PROD: {
		minIndexingCapacityInOcu: 0,
		minSearchCapacityInOcu: 0,
		maxIndexingCapacityInOcu: 8,
		maxSearchCapacityInOcu: 8,
	},
};

type TroveOpenSearchProps = GuStackProps & {
	stage: 'CODE' | 'PROD';
};

export class TroveOpenSearch extends GuStack {
	constructor(scope: App, id: string, props: TroveOpenSearchProps) {
		super(scope, id, props);

		const stage = props.stage;

		const name = collectionName(stage);
		const collectionResource = `collection/${name}`;

		const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
			name: `trove-encryption-${stage.toLowerCase()}`,
			type: 'encryption',
			policy: JSON.stringify({
				Rules: [{ ResourceType: 'collection', Resource: [collectionResource] }],
				AWSOwnedKey: true,
			}),
		});

		// Public endpoint: access is still gated by IAM and data access policies
		const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
			name: `trove-network-${stage.toLowerCase()}`,
			type: 'network',
			policy: JSON.stringify([
				{
					Rules: [
						{ ResourceType: 'collection', Resource: [collectionResource] },
						{ ResourceType: 'dashboard', Resource: [collectionResource] },
					],
					// this cluster only contains data that is publicly available
					// a tight IAM should be simpler than having to handle VPCs
					AllowFromPublic: true,
				},
			]),
		});

		const group = new CfnCollectionGroup(this, 'CollectionGroup', {
			name,
			generation: 'NEXTGEN',
			standbyReplicas: 'ENABLED',
			capacityLimits: capacityLimitsByStage[stage],
		});
		group.applyRemovalPolicy(RemovalPolicy.RETAIN);

		const collection = new CfnCollection(this, 'Collection', {
			name,
			type: 'VECTORSEARCH',
			collectionGroupName: group.name,
			standbyReplicas: 'ENABLED',
			deletionProtection: 'ENABLED',
		});
		collection.addResourceDependency(encryptionPolicy);
		collection.addResourceDependency(networkPolicy);
		collection.addResourceDependency(group);
		collection.applyRemovalPolicy(RemovalPolicy.RETAIN);

		const parameterNames = openSearchParameterNames(stage);
		new StringParameter(this, 'EndpointParameter', {
			parameterName: parameterNames.endpoint,
			description: 'Endpoint of the Trove OpenSearch Serverless collection',
			stringValue: collection.attrCollectionEndpoint,
		});
		new StringParameter(this, 'CollectionArnParameter', {
			parameterName: parameterNames.collectionArn,
			description: 'ARN of the Trove OpenSearch Serverless collection',
			stringValue: collection.attrArn,
		});

		const engineerRoleArn = `arn:aws:iam::${this.account}:role/federation/janus-access-role-${this.region}`;

		// OpenSearch UI, the console to explore the collection
		new CfnApplication(this, 'OpenSearchUi', {
			name,
			dataSources: [{ dataSourceArn: collection.attrArn }],
			appConfigs: [
				{
					key: 'opensearchDashboards.dashboardAdmin.groups',
					value: this.toJsonString([engineerRoleArn]),
				},
			],
		});

		new CfnAccessPolicy(this, 'EngineerDataAccessPolicy', {
			name: `trove-engineers-${stage.toLowerCase()}`,
			type: 'data',
			policy: this.toJsonString([
				{
					Rules: [
						{
							ResourceType: 'index',
							Resource: [`index/${name}/articles-*`],
							Permission: [
								'aoss:CreateIndex',
								'aoss:DeleteIndex',
								'aoss:DescribeIndex',
								'aoss:UpdateIndex',
								'aoss:ReadDocument',
								'aoss:WriteDocument',
							],
						},
					],
					Principal: [
						// engineer access
						engineerRoleArn,
					],
				},
			]),
		});
	}
}
