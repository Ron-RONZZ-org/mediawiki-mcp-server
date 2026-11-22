import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
	DATASET_ACCESS_TIERS,
	DATASET_MANIFEST_TOP_LEVEL_KEYS,
	DATASET_MANIFEST_VERSION,
	DATASET_REQUIRED_FOR_APPLY,
	DATASET_REQUIRED_FOR_VALIDATE,
	DATASET_STORE_FIELDS,
} from '../../../../src/tools/extensions/embeddable-content/generated/datasetContract.ts';

// The cross-language half of the dataset contract: the pinned JSON Schema and
// the golden example must validate, and the generated TypeScript constants
// must be a faithful projection of the pinned files. The wiki emits both; CI's
// `gen:dataset-contract` + `git diff --exit-code` keeps the generated file in
// step.

const contract = (name: string): string =>
	join(
		dirname(fileURLToPath(import.meta.url)),
		'../../../../src/tools/extensions/embeddable-content/contract',
		name,
	);

const json = (name: string): Record<string, unknown> =>
	JSON.parse(readFileSync(contract(name), 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });

describe('dataset contract', () => {
	it('validates the golden manifest example', () => {
		const validate = ajv.compile(json('dataset-manifest.schema.json'));
		const example = json('dataset-manifest.example.json');
		expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
	});

	it('validates the envelope example and its report', () => {
		const validate = ajv.compile(json('dataset-envelope.schema.json'));
		const example = json('dataset-envelope.example.json');
		expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
	});

	it('projects the pinned schema into the generated constants', () => {
		const schema = json('dataset-manifest.schema.json') as {
			properties: Record<string, { properties: Record<string, unknown> }>;
		};
		expect(DATASET_MANIFEST_VERSION).toBe(
			(schema.properties.manifest_version as unknown as { const: string }).const,
		);
		expect([...DATASET_MANIFEST_TOP_LEVEL_KEYS]).toEqual(Object.keys(schema.properties));
		expect([...DATASET_ACCESS_TIERS]).toEqual(
			(schema.properties.dataset.properties.access_tier as unknown as { enum: string[] }).enum,
		);
	});

	it('separates validate-required from apply-required fields', () => {
		expect(DATASET_STORE_FIELDS['dataset.dataset_id'].requiredFor).toEqual(['validate', 'apply']);
		expect(DATASET_STORE_FIELDS['tables[].pdf_sha1'].requiredFor).toEqual(['apply']);
		expect(DATASET_REQUIRED_FOR_APPLY).toContain('tables[].pdf_sha1');
		expect(DATASET_REQUIRED_FOR_VALIDATE).toContain('dataset.title');
		expect(DATASET_REQUIRED_FOR_VALIDATE).not.toContain('tables[].pdf_sha1');
	});

	it('pins the same manifest version as the store map', () => {
		const store = json('dataset-store-fields.json') as { manifest_version: string };
		expect(store.manifest_version).toBe(DATASET_MANIFEST_VERSION);
	});
});
