import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

/** Signs requests for OpenSearch Serverless when OPENSEARCH_ENDPOINT is set, otherwise targets docker-compose. */
export const createClient = (): Client => {
	const endpoint = process.env.OPENSEARCH_ENDPOINT;
	if (!endpoint) {
		return new Client({ node: 'http://localhost:9200' });
	}

	return new Client({
		...AwsSigv4Signer({
			region: process.env.AWS_REGION ?? 'eu-west-1',
			service: 'aoss',
			getCredentials: defaultProvider(),
		}),
		node: endpoint,
	});
};
