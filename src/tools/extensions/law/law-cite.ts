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
			'The article reference code from law-search (e.g. L111-1, 24, arrêt, 20). Omit for a court decision (CASS/CONSTIT/JADE) to cite the decision item.',
		),
} as const;

export const lawCite: Tool<typeof inputSchema> = {
	name: 'law-cite',
	description:
		"Cite-or-create one law-corpus unit through the wiki's action=lawcite. For legislation the wiki reads the article text from the corpus and creates the entity-only legal-provision item on first call; for a court decision (CASS/CONSTIT/JADE) it returns (and creates on first use) the decision's legal-case item. No Source: page is created. Returns the citable Q-id and the internal <ref>{{#cite:Q…}}</ref> snippet; repeat calls return the same item. Use law-search to find the law_key/reference_code, and citation-get-citation on the returned qid for a formatted citation. The item's readable page is Special:Law/<law_key>[/<article>].",
	inputSchema,
	annotations: {
		title: 'Cite a law-corpus unit',
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'cite the law-corpus unit',
	target: (a) => (a.article !== undefined && a.article !== '' ? `${a.law}/${a.article}` : a.law),

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const raw = await ctx.edit.submit(mwn, {
			action: 'lawcite',
			law: args.law,
			...(args.article !== undefined && args.article !== '' ? { article: args.article } : {}),
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=lawcite response shape; trusted at this boundary
		const response = raw as { lawcite?: Record<string, unknown> };
		return ctx.format.ok(response.lawcite ?? {});
	},
};
