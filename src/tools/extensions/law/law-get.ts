import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const inputSchema = {
	law: z
		.string()
		.min(1)
		.max(64)
		.describe(
			'The law key from law-search (LEGITEXT…, CONSTEXT…, JURITEXT…, CETATEXT… in the FR corpus).',
		),
	article: z
		.string()
		.max(191)
		.optional()
		.describe(
			'The article reference code (e.g. L111-1, 24, arrêt, 20). Omit for the law row + its article list.',
		),
	language: z.string().max(20).default('fr').describe('Corpus language (fr in v1).'),
} as const;

export const lawGet: Tool<typeof inputSchema> = {
	name: 'law-get',
	description:
		"Reads one law or one article from the RonzzWikiBase law corpus through the wiki's action=lawget. Returns the law row (official identifier, title, nature, number, court, status, version dates, source URL) and, when `article` is given, the article row with its text, reference code, section path and status. A Conseil constitutionnel decision is split into its numbered considérants; a Cour de cassation or JADE decision is one row (arrêt/avis/ordonnance/décision). Use law-search first to discover the law_key and reference code.",
	inputSchema,
	annotations: {
		title: 'Read a law or article',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'read the law corpus',
	target: (a) => `${a.law}${a.article !== undefined ? `/${a.article}` : ''}`,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const params: Record<string, string> = { action: 'lawget', law: args.law };
		if (args.article !== undefined && args.article !== '') {
			params.article = args.article;
		}
		if (args.language !== '') {
			params.language = args.language;
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=lawget response shape; trusted at this boundary
		const response = (await mwn.request(params)) as { lawget?: Record<string, unknown> };
		return ctx.format.ok(response.lawget ?? {});
	},
};
