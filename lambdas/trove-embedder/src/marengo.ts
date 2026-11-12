import type { InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { embeddingModels } from 'datastore/open-search-embeddings';
import { z } from 'zod';

const model = embeddingModels.marengo_3_0;
// Marengo can only be invoked on demand in eu-west-1 through the EU inference profile
const inferenceProfileId = `eu.${model.modelId}`;

export type Embed = (text: string) => Promise<number[]>;

/** The subset of Bedrock's InvokeModel we rely on, so tests can supply a fake. */
export type InvokeModel = (
	input: InvokeModelCommandInput,
) => Promise<{ body: Uint8Array }>;

const MarengoEmbedding = z.object({
	embedding: z.array(z.number()).length(model.dimension),
});

// Text input yields a single embedding; the docs are ambiguous on whether it's wrapped in a list
const MarengoTextResponse = z.object({
	data: z.union([
		MarengoEmbedding,
		z.tuple([MarengoEmbedding]).transform(([embedding]) => embedding),
	]),
});

export const createMarengoEmbedder =
	(invokeModel: InvokeModel): Embed =>
	async (text) => {
		const response = await invokeModel({
			modelId: inferenceProfileId,
			contentType: 'application/json',
			accept: 'application/json',
			body: JSON.stringify({ inputType: 'text', text: { inputText: text } }),
		});
		const json: unknown = JSON.parse(new TextDecoder().decode(response.body));
		return MarengoTextResponse.parse(json).data.embedding;
	};
