import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const inputSchema = {
	q: z
		.string()
		.max(500)
		.optional()
		.describe('A law title or an article reference code (e.g. "Code civil", "L111-1").'),
	law: z
		.string()
		.max(64)
		.optional()
		.describe('Restrict to one law by its official key (LEGITEXT… in the FR corpus).'),
	jurisdiction: z.string().max(16).optional().describe('FR (v1). EU is the v2 corpus.'),
	limit: z.number().int().min(1).max(100).default(20).describe('Maximum rows per list.'),
} as const;

export const lawSearch: Tool<typeof inputSchema> = {
	name: 'law-search',
	description:
		"Searches the RonzzWikiBase law corpus through the wiki's action=lawsearch. Use it before law-cite: pass the law title or an article reference, then pick the exact law_key + reference_code from the result. The corpus is the offline, versioned text from the official open-data source (DILA LEGI for France, v1); it is not a live legal-API call. Returns `laws` and `articles` rows with law_key, reference_code, section_path, status and any existing citable item_id.",
	inputSchema,
	annotations: {
		title: 'Search the law corpus',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'search the law corpus',
	target: (a) => a.law ?? a.q ?? 'law corpus',

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const params: Record<string, string | number> = {
			action: 'lawsearch',
			limit: args.limit,
		};
		for (const key of ['q', 'law', 'jurisdiction'] as const) {
			const value = args[key];
			if (value !== undefined && value !== '') {
				params[key] = value;
			}
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=lawsearch response shape; trusted at this boundary
		const response = (await mwn.request(params)) as {
			lawsearch?: { laws?: unknown[]; articles?: unknown[]; limit?: number };
		};
		return ctx.format.ok(response.lawsearch ?? { laws: [], articles: [] });
	},
};
