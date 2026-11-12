import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createHandler } from './handler.ts';
import { createMarengoEmbedder } from './marengo.ts';

const bedrock = new BedrockRuntimeClient({
	region: process.env.AWS_REGION ?? 'eu-west-1',
});

export const handler = createHandler({
	embed: createMarengoEmbedder((input) =>
		bedrock.send(new InvokeModelCommand(input)),
	),
});
