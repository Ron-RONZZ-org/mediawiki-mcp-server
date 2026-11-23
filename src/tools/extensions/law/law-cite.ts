import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const inputSchema = {
	law: z
		.string()
		.min(1)
		.max(64)
		.describe('The law key from law-search (LEGITEXT… in the FR corpus).'),
	article: z
		.string()
		.min(1)
		.max(191)
		.describe('The article reference code from law-search (e.g. L111-1).'),
} as const;

export const lawCite: Tool<typeof inputSchema> = {
	name: 'law-cite',
	description:
		"Cite-or-create one law-corpus article through the wiki's action=lawcite. The wiki reads the article text from the corpus and creates the entity-only legal-provision item on first call (no Source: page), returning the citable Q-id and the internal <ref>{{#cite:Q…}}</ref> snippet. Repeat calls return the same item. Use law-search to find the law_key/reference_code, and citation-get-citation on the returned qid for a formatted citation. The item's readable page is Special:Law/<law_key>/<article>.",
	inputSchema,
	annotations: {
		title: 'Cite a law-corpus article',
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'cite the law-corpus article',
	target: (a) => `${a.law}/${a.article}`,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const raw = await ctx.edit.submit(mwn, {
			action: 'lawcite',
			law: args.law,
			article: args.article,
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=lawcite response shape; trusted at this boundary
		const response = raw as { lawcite?: Record<string, unknown> };
		return ctx.format.ok(response.lawcite ?? {});
	},
};
