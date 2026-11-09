import { z } from 'zod';
import { openSearchProperty } from './mapping.ts';

type EmbeddingModel = {
	/** Bedrock model ID */
	modelId: string;
	dimension: number;
	spaceType: string;
};

// Keys are short aliases because OpenSearch treats dots in field names as object paths
export const embeddingModels = {
	marengo_3_0: {
		modelId: 'twelvelabs.marengo-embed-3-0-v1:0',
		dimension: 512,
		spaceType: 'cosinesimil',
	},
} as const satisfies Record<string, EmbeddingModel>;

/**
 * A `knn_vector` field holding an embedding from the given model.
 * No `method`: Serverless NextGen picks the engine itself and rejects one being set.
 */
export const knnVector = ({ dimension, spaceType }: EmbeddingModel) =>
	z.array(z.number()).length(dimension).register(openSearchProperty, {
		type: 'knn_vector',
		dimension,
		space_type: spaceType,
	});
