import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { ITEM_ID } from '../embeddable-content/embeddableWrite.ts';

const inputSchema = {
	entityId: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q96')
		.describe(
			'The item to cite: a source item created via embeddable-add-citation-source, or any item the citation engine can format.',
		),
	style: z
		.enum(['json', 'apa', 'vancouver', 'bibtex', 'ris'])
		.default('apa')
		.describe(
			'The citation style: apa (author–date), vancouver (numbered), bibtex (a @book{…} entry for LaTeX), ris (a tagged record for reference managers), or json (the raw CSL-JSON structure).',
		),
	output: z
		.enum(['html', 'text'])
		.default('text')
		.describe(
			'The output form of the formatted citation: text for plain text, html for the sanitized HTML rendition. Ignored for style=json, which returns the CSL structure.',
		),
} as const;

interface CitationResponse {
	entity?: string;
	style?: string;
	citation?: unknown;
}

export const citationGetCitation: Tool<typeof inputSchema> = {
	name: 'citation-get-citation',
	description:
		"Formats a formatted citation for one item through the wiki's citation API (the same engine behind the item page's Copy citation button) and returns it in the requested style. Enabled only when the wiki has the WikibaseCitation extension.\n\nUse it to obtain the citation text an agent needs to paste into a bibliography or reference manager; the {{#cite:Qxx}} parser function renders citations on pages directly, so this tool is for fetching the text itself. The citation is generated from the item's statements at call time.",
	inputSchema,
	annotations: {
		title: 'Get citation',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'get citation',
	target: (a) => a.entityId,

	async handle({ entityId, style, output }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=citation response shape; trusted at this boundary
		const response = (await mwn.request({
			action: 'citation',
			entity: entityId.toUpperCase(),
			style,
			output,
			format: 'json',
			formatversion: '2',
		})) as CitationResponse;

		if (response.citation === undefined) {
			return ctx.format.error(
				'upstream_failure',
				`The citation API returned no citation for entity "${entityId.toUpperCase()}".`,
			);
		}
		return ctx.format.ok({
			entityId: response.entity ?? entityId.toUpperCase(),
			style: response.style ?? style,
			citation: response.citation,
		});
	},
};
