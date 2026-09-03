import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { formatEditComment } from '../../../wikis/utils.ts';
import { lostSetSitelinkResult } from './wikibaseWriteOutcome.ts';

const inputSchema = {
	qid: z
		.string()
		.regex(/^[Qq]\d+$/, 'An item ID, such as Q42')
		.describe('The item to link the page to.'),
	page: z
		.string()
		.min(1)
		.describe(
			"Wiki page title on this wiki's own site (the sitelink site), e.g. Cheatsheets:Markdown. The page must exist.",
		),
	site: z
		.string()
		.min(1)
		.optional()
		.describe("The sitelink site id. Defaults to wikibase, the repo's own site id."),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

interface SetSitelinkResponse {
	entity?: { id?: string; lastrevid?: number };
}

export const wikibaseSetSitelink: Tool<typeof inputSchema> = {
	name: 'wikibase-setsitelink',
	description:
		"Links a wiki page to a Wikibase item by setting the item's sitelink for the wiki's own site, and returns the item ID and latest revision. Enabled only when the wiki is a Wikibase repository. Requires the edit right.\n\nThis is the page↔item link the Sitelink tab on each page makes: with it, parser functions without a from= argument ({{#statements:P1}}, {{#item-image:}}) resolve the current page to its item, and the item page shows the link in its Sitelinks section. An existing sitelink for the site is replaced. When the wiki's response is lost and no entity comes back, the tool re-reads the item's sitelinks and reports whether the link was set before you retry. To link the item to another wiki's site instead, use wikibase-edit-entity with a sitelinks block in the entity JSON.",
	inputSchema,
	annotations: {
		title: 'Set sitelink',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'set sitelink',
	target: (a) => a.qid,

	async handle({ qid, page, site, comment }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const siteKey = site ?? 'wikibase';
		const summary = formatEditComment(ctx, 'wikibase-setsitelink', comment);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsetsitelink response shape; trusted at this boundary
		const response = (await ctx.edit.submit(mwn, {
			action: 'wbsetsitelink',
			id: qid.toUpperCase(),
			linksite: siteKey,
			linktitle: page,
			...(summary !== undefined ? { summary } : {}),
		})) as SetSitelinkResponse | undefined;

		const entity = response?.entity;
		if (entity?.id === undefined) {
			// Lost response: re-read the item's sitelinks and report whether
			// the link landed instead of guessing.
			return lostSetSitelinkResult(ctx, { qid: qid.toUpperCase(), site: siteKey, page });
		}
		return ctx.format.ok({
			entityId: entity.id,
			latestRevisionId: entity.lastrevid,
			sitelinkSite: siteKey,
			page,
		});
	},
};
