import { defaultProvider } from '@aws-sdk/credential-provider-node';

export const awsClientConfig = {
	region: process.env.AWS_REGION ?? 'eu-west-1',
	credentials: process.env.STAGE
		? defaultProvider()
		: defaultProvider({ profile: 'capi' }),
};
