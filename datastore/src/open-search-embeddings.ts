import type { Types } from '@opensearch-project/opensearch';
import { z } from 'zod';
import { os } from './mapping.ts';

type EmbeddingModel = {
	/** Bedrock model ID */
	modelId: string;
	dimension: number;
	method: Types.Common_Mapping.KnnVectorProperty['method'];
};

// Keys are short aliases because OpenSearch treats dots in field names as object paths
export const embeddingModels = {
	marengo_3_0: {
		modelId: 'twelvelabs.marengo-embed-3-0-v1:0',
		dimension: 512,
		method: { name: 'hnsw', engine: 'faiss', space_type: 'cosinesimil' },
	},
} as const satisfies Record<string, EmbeddingModel>;

/** A `knn_vector` field holding an embedding from the given model. */
export const knnVector = ({ dimension, method }: EmbeddingModel) =>
	z
		.array(z.number())
		.length(dimension)
		.register(os, { type: 'knn_vector', dimension, method });
