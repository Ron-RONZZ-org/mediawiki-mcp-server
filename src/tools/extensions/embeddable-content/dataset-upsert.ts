import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { UploadValidationError } from '../../../wikis/uploadDirs.ts';
import {
	DATASET_MANIFEST_TOP_LEVEL_KEYS,
	DATASET_MANIFEST_VERSION,
	DATASET_REQUIRED_FOR_APPLY,
} from './generated/datasetContract.ts';

const MANIFEST_MAX_BYTES = 1_000_000;
const MANIFEST_MAX_CELLS = 2_000;

const inputSchema = {
	manifest: z
		.union([z.record(z.string(), z.unknown()), z.string().min(1)])
		.describe(
			'The dataset manifest object, the extractor envelope ({ manifest, validation_report, manifest_path }), or a path to either file inside an allowed upload directory. The manifest is the shared contract emitted by the wiki (dataset-manifest.schema.json).',
		),
	mode: z
		.enum(['validate', 'apply'])
		.default('validate')
		.describe(
			"validate runs the wiki's dry-run validation and writes nothing; apply saves the manifest, queues the datasetApply job and returns its run_id. Poll with dataset-status.",
		),
} as const;

type Manifest = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts the extractor envelope or a bare manifest. */
function unwrap(input: unknown): { manifest: Manifest; report: unknown } {
	if (isRecord(input) && isRecord(input.manifest)) {
		return { manifest: input.manifest, report: input.validation_report };
	}
	if (isRecord(input)) {
		return { manifest: input, report: undefined };
	}
	throw new Error('the manifest must be a JSON object (or a path to one)');
}

/** True when every object along `path` (expanding `[]`) carries a non-empty leaf. */
function present(manifest: Manifest, path: string): boolean {
	const parts = path.split('.');
	let current: unknown[] = [manifest];
	for (const part of parts) {
		const array = /^(.*)\[\]$/.exec(part);
		const key = array ? array[1] : part;
		const next: unknown[] = [];
		for (const node of current) {
			if (!isRecord(node)) {
				continue;
			}
			const value = node[key];
			if (array) {
				if (Array.isArray(value)) {
					next.push(...value);
				}
			} else if (value !== undefined && value !== null && value !== '') {
				next.push(value);
			}
		}
		current = next;
		if (current.length === 0) {
			return false;
		}
	}
	return current.length > 0;
}

async function loadManifest(
	value: string | Manifest,
	ctx: ToolContext,
): Promise<{ manifest: Manifest; report: unknown }> {
	if (typeof value !== 'string') {
		return unwrap(value);
	}
	let resolved: string;
	try {
		resolved = await ctx.uploadDirs.resolve(value);
	} catch (error) {
		if (error instanceof UploadValidationError) {
			throw new Error(`manifest path is not readable: ${error.message}`);
		}
		throw error;
	}
	const text = await readFile(resolved, 'utf8');
	return unwrap(JSON.parse(text) as unknown);
}

export const datasetUpsert: Tool<typeof inputSchema> = {
	name: 'embeddable-dataset-upsert',
	description:
		"Validates or applies a curated dataset manifest through the wiki's action=datasetupsert. The manifest is the shared contract emitted by the wiki (dataset-manifest.schema.json) and returned unchanged by pdf-figures-mcp extract_pdf_table, so the extractor's envelope can be passed as-is. mode='validate' runs the authoritative dry-run and writes nothing; mode='apply' saves the manifest, queues the datasetApply job and returns a run_id to poll with dataset-status. The tool enforces the contract version, the top-level shape, the apply-required fields and the 1 MB manifest cap before calling the wiki; the wiki remains the authoritative validator.",
	inputSchema,
	annotations: {
		title: 'Validate or apply a dataset manifest',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'upsert the dataset',
	target: (a) => (typeof a.manifest === 'string' ? a.manifest : 'manifest'),

	async handle({ manifest, mode }, ctx: ToolContext): Promise<CallToolResult> {
		let loaded: { manifest: Manifest; report: unknown };
		try {
			loaded = await loadManifest(manifest, ctx);
		} catch (error) {
			return ctx.format.invalidInput(error instanceof Error ? error.message : String(error));
		}
		const { manifest: doc, report } = loaded;

		if (doc.manifest_version !== DATASET_MANIFEST_VERSION) {
			return ctx.format.invalidInput(
				`manifest_version must be "${DATASET_MANIFEST_VERSION}" (got ${JSON.stringify(doc.manifest_version)}).`,
			);
		}
		const unknown = Object.keys(doc).filter(
			(key) => !(DATASET_MANIFEST_TOP_LEVEL_KEYS as readonly string[]).includes(key),
		);
		if (unknown.length > 0) {
			return ctx.format.invalidInput(
				`unknown top-level manifest field(s): ${unknown.join(', ')}. The contract is strict; re-emit the manifest against dataset-manifest.schema.json.`,
			);
		}
		if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MANIFEST_MAX_BYTES) {
			return ctx.format.invalidInput(
				`the manifest exceeds the ${MANIFEST_MAX_BYTES} byte cap; split the dataset or reduce the table.`,
			);
		}
		const cells = Array.isArray(doc.tables)
			? doc.tables.reduce(
					(total, table) =>
						total +
						(isRecord(table) && Array.isArray(table.observations) ? table.observations.length : 0),
					0,
				)
			: 0;
		if (cells > MANIFEST_MAX_CELLS) {
			return ctx.format.invalidInput(
				`the manifest has ${cells} cells; the v1 cap is ${MANIFEST_MAX_CELLS}. Split the dataset or migrate to the wide-table path.`,
			);
		}
		if (mode === 'apply') {
			const missing = DATASET_REQUIRED_FOR_APPLY.filter((path) => !present(doc, path));
			if (missing.length > 0) {
				return ctx.format.invalidInput(
					`apply requires fields that are missing: ${missing.join(', ')}.`,
				);
			}
		}

		const mwn = await ctx.mwn();
		const raw = await ctx.edit.submit(mwn, {
			action: 'datasetupsert',
			manifest: JSON.stringify(doc),
			...(mode === 'validate' ? { dryrun: '1' } : { apply: '1' }),
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=datasetupsert response shape; trusted at this boundary
		const response = raw as { datasetupsert?: Record<string, unknown> };

		const result = response.datasetupsert ?? {};
		return ctx.format.ok({
			...result,
			...(report !== undefined ? { extractorReport: report } : {}),
		});
	},
};
