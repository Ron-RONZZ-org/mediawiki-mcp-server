#!/usr/bin/env node
// Projects the pinned dataset contract (contract/dataset-manifest.schema.json
// + contract/dataset-store-fields.json, emitted by the ronzz-wikibase
// EmbeddableContent extension) to the TypeScript constants the dataset tools
// use.
//
// CI runs this inside `preflight` and fails on `git diff --exit-code`, so a
// hand-edited generated file, or a contract change without regeneration,
// cannot land. `tests/tools/extensions/embeddable-content/dataset-contract.test.ts`
// checks the same at test time.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractDir = path.join(root, 'src/tools/extensions/embeddable-content/contract');
const outPath = path.join(
	root,
	'src/tools/extensions/embeddable-content/generated/datasetContract.ts',
);

const schema = JSON.parse(
	fs.readFileSync(path.join(contractDir, 'dataset-manifest.schema.json'), 'utf8'),
);
const report = JSON.parse(
	fs.readFileSync(path.join(contractDir, 'validation-report.schema.json'), 'utf8'),
);
const store = JSON.parse(
	fs.readFileSync(path.join(contractDir, 'dataset-store-fields.json'), 'utf8'),
);

const tuple = (values) => `[${values.map((value) => `'${value}'`).join(', ')}]`;
const strings = (values) => values.filter((value) => typeof value === 'string');
const dataset = schema.properties.dataset.properties;
const table = schema.properties.tables.items.properties;
const column = table.columns.items.properties;
const footnote = table.footnotes.items.properties;
const run = table.extraction_runs.items.properties;
const checks = report.properties.checks.items.properties;

const requiredFor = (tier) =>
	Object.keys(store.fields).filter((key) => store.fields[key].requiredFor.includes(tier));

const storeLines = Object.entries(store.fields).map(([manifestPath, entry]) => {
	const parts = [`store: '${entry.store}'`, `requiredFor: ${tuple(entry.requiredFor)}`];
	if (entry.generatedIfMissing) {
		parts.push('generatedIfMissing: true');
	}
	return `\t'${manifestPath}': { ${parts.join(', ')} },`;
});

const generatedLines = Object.entries(store.generated).map(
	([field, from]) => `\t'${field}': '${from.replace(/'/g, "\\'")}',`,
);

const output = `// AUTO-GENERATED — do not edit by hand.
//
// Source: contract/dataset-manifest.schema.json + contract/dataset-store-fields.json,
// emitted by the ronzz-wikibase EmbeddableContent extension
// (maintenance/emitDatasetContract.php). Refresh the pinned files first, then:
//
//   npm run gen:dataset-contract

export const DATASET_MANIFEST_VERSION = '${schema.properties.manifest_version.const}' as const;
export const DATASET_MANIFEST_TOP_LEVEL_KEYS = ${tuple(Object.keys(schema.properties))} as const;
export const DATASET_ACCESS_TIERS = ${tuple(strings(dataset.access_tier.enum))} as const;
export const DATASET_STATUSES = ${tuple(strings(dataset.status.enum))} as const;
export const DATASET_COLUMN_DATATYPES = ${tuple(strings(column.datatype.enum))} as const;
export const DATASET_COLUMN_ROLES = ${tuple(strings(column.role.enum))} as const;
export const DATASET_FOOTNOTE_SCOPES = ${tuple(strings(footnote.scope.enum))} as const;
export const DATASET_FOOTNOTE_STATUSES = ${tuple(strings(footnote.status.enum))} as const;
export const DATASET_RUN_STATUSES = ${tuple(strings(run.status.enum))} as const;
export const DATASET_METHODS = ${tuple(strings(table.method.enum))} as const;
export const DATASET_REVIEW_STATUSES = ${tuple(strings(table.review_status.enum))} as const;
export const DATASET_SOURCE_FILE_ACCESS = ${tuple(strings(table.source_file_access.enum))} as const;
export const DATASET_ERROR_CODES = ${tuple(strings(checks.code.enum))} as const;

export type DatasetStoreField = {
	store: string;
	requiredFor: readonly ('validate' | 'apply')[];
	generatedIfMissing?: boolean;
};

export const DATASET_STORE_FIELDS = {
${storeLines.join('\n')}
} as const satisfies Record<string, DatasetStoreField>;

export const DATASET_GENERATED_FIELDS = {
${generatedLines.join('\n')}
} as const;

export const DATASET_REQUIRED_FOR_VALIDATE = ${tuple(requiredFor('validate'))} as const;
export const DATASET_REQUIRED_FOR_APPLY = ${tuple(requiredFor('apply'))} as const;
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output);
execFileSync(path.join(root, 'node_modules/.bin/oxfmt'), [outPath], { stdio: 'inherit' });
process.stdout.write(`wrote ${path.relative(root, outPath)}\n`);
