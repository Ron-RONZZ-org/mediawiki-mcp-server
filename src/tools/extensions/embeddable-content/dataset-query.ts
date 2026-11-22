import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const HARD_LIMIT = 5000;

const inputSchema = {
	dataset_id: z
		.string()
		.optional()
		.describe('Stable dataset slug, e.g. bond-titus-1983. Omit to list across datasets.'),
	table_id: z.string().optional().describe('Stable table key, e.g. bond-titus-1983-t1.'),
	panel_key: z.string().optional().describe('Restrict observations to one panel key (p1, p2, …).'),
	column_key: z.string().optional().describe('Restrict observations to one column key.'),
	search: z
		.string()
		.optional()
		.describe('Full-text search over the dataset/table/column/cell search_text fields.'),
	order: z
		.string()
		.optional()
		.describe('Ordering, e.g. "tables[0].observations.row_index" or "dataset.year DESC".'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(HARD_LIMIT)
		.default(500)
		.describe('Maximum rows to return (hard cap 5000).'),
	offset: z.number().int().min(0).default(0).describe('Pagination offset.'),
	format: z
		.enum(['json', 'csv'])
		.default('json')
		.describe('json returns structured rows; csv returns the export text.'),
} as const;

export const datasetQuery: Tool<typeof inputSchema> = {
	name: 'embeddable-dataset-query',
	description:
		"Returns rows from the curated dataset store through the wiki's action=datasetquery. Filters by dataset_id, table_id, panel_key, column_key and a full-text search term, with pagination and json/csv output. The access tier is enforced by the wiki (public / registered / internal deny-by-default). Use embeddable-dataset-upsert to write; use cargo-query only for wikis that actually run the Cargo extension.",
	inputSchema,
	annotations: {
		title: 'Query a curated dataset',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'query the dataset',
	target: (a) => a.dataset_id ?? a.table_id ?? 'dataset',

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const params: Record<string, string | number> = {
			action: 'datasetquery',
			format: args.format,
			limit: args.limit,
			offset: args.offset,
		};
		for (const key of [
			'dataset_id',
			'table_id',
			'panel_key',
			'column_key',
			'search',
			'order',
		] as const) {
			const value = args[key];
			if (value !== undefined && value !== '') {
				params[key] = value;
			}
		}
		// A csv response is not JSON; bypass mwn's JSON parser.
		if (args.format === 'csv') {
			const response = await mwn.rawRequest(params);
			const text =
				typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
			return ctx.format.ok({ format: 'csv', text });
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=datasetquery response shape; trusted at this boundary
		const response = (await mwn.request(params)) as { datasetquery?: Record<string, unknown> };
		return ctx.format.ok(response.datasetquery ?? { rows: [] });
	},
};
