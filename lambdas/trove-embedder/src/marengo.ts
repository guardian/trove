import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { embeddingModels } from 'datastore/open-search-embeddings';
import { awsClientConfig } from 'shared/aws';
import { z } from 'zod';

// Marengo can only be invoked on demand in eu-west-1 through the EU inference profile
const inferenceProfileId = `eu.${embeddingModels.marengo_3_0.modelId}`;

const bedrock = new BedrockRuntimeClient(awsClientConfig);

// Text input returns a single embedding, wrapped in a list
const MarengoTextResponse = z.object({
	data: z.tuple([z.object({ embedding: z.array(z.number()) })]),
});

export async function embedText(text: string): Promise<number[]> {
	const response = await bedrock.send(
		new InvokeModelCommand({
			modelId: inferenceProfileId,
			contentType: 'application/json',
			accept: 'application/json',
			body: JSON.stringify({ inputType: 'text', text: { inputText: text } }),
		}),
	);
	const json: unknown = JSON.parse(new TextDecoder().decode(response.body));
	return MarengoTextResponse.parse(json).data[0].embedding;
}
