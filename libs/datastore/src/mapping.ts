import type { Types } from '@opensearch-project/opensearch';
import { z } from 'zod';

type Property = Types.Common_Mapping.Property;

/** Attach OpenSearch field mappings to zod schemas, overriding the defaults below. */
export const openSearchProperty = z.registry<Property>();

export const toMapping = (
	schema: z.ZodObject,
): Types.Common_Mapping.TypeMapping => ({
	// Nested objects inherit this, so any field not in the schema is rejected
	dynamic: 'strict',
	properties: properties(schema),
});

const properties = (obj: z.ZodObject): Record<string, Property> =>
	Object.fromEntries(
		Object.entries(obj.shape).map(([key, value]) => [
			key,
			field(value as z.ZodType),
		]),
	);

// This function provide sensible default for any structural type (object, array, option, ...)
// And for unambiguous types such as date and boolean.
// However, any other type will need to be explicitly registered to avoid any ambiguity. (string = text or keyword?)
function field(schema: z.ZodType): Property {
	// Checked first so registered arrays (e.g. knn_vector) aren't mapped as their element type
	const meta = openSearchProperty.get(schema);
	if (meta) {
		return meta;
	}
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
		return field(schema.unwrap() as z.ZodType);
	}
	// OpenSearch fields are multi-valued, so an array maps like its element
	if (schema instanceof z.ZodArray) {
		return field(schema.element as z.ZodType);
	}
	if (schema instanceof z.ZodObject) {
		return { properties: properties(schema) };
	}
	if (schema instanceof z.ZodISODateTime) {
		return { type: 'date' };
	}
	if (schema instanceof z.ZodBoolean) {
		return { type: 'boolean' };
	}
	throw new Error(`No OpenSearch mapping for zod type "${schema.def.type}"`);
}
