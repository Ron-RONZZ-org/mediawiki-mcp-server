import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { ITEM_ID, LANGUAGE_CODE } from './embeddableWrite.ts';

const inputSchema = {
	entityId: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q100')
		.describe(
			'The item to render: a quotation, code snippet or mathematical expression item created via embeddable-add-special-content, or any EmbeddableContent item.',
		),
	output: z
		.enum(['html', 'json'])
		.default('html')
		.describe(
			"The render format: html returns the rendered fragment as it would appear embedded; json adds the list of available languages. Use json when the item's language variants matter.",
		),
	language: z
		.string()
		.regex(LANGUAGE_CODE, 'A single lowercase language code, such as en or fr')
		.optional()
		.describe(
			"Language to render the content in. Omitted, the wiki negotiates from the caller's accepted languages; pass a code to pin one.",
		),
} as const;

interface EmbedResponse {
	embed?: {
		kind?: string;
		title?: string;
		lang?: string;
		html?: string;
		languages?: string[];
	};
}

export const embeddableGetEmbedContent: Tool<typeof inputSchema> = {
	name: 'embeddable-get-embed-content',
	description:
		"Renders one EmbeddableContent item through the wiki's embed API (the same renderer as Special:Embed and the Copy embed code snippet) and returns the rendered fragment, its kind, title and language. Enabled only when the wiki has the EmbeddableContent extension.\n\nThis is the read counterpart of embeddable-add-special-content: it is how an agent sees what an item actually renders as before pasting the embed snippet onto a page. For the item's statements instead of its rendering, use wikibase-get-entity.",
	inputSchema,
	annotations: {
		title: 'Get embed content',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'render embed content',
	target: (a) => a.entityId,

	async handle({ entityId, output, language }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=embed response shape; trusted at this boundary
		const response = (await mwn.request({
			action: 'embed',
			entity: entityId.toUpperCase(),
			output,
			...(language !== undefined ? { lang: language } : {}),
			format: 'json',
			formatversion: '2',
		})) as EmbedResponse;

		const embed = response.embed;
		if (embed === undefined) {
			return ctx.format.error(
				'upstream_failure',
				`The embed API returned no content for entity "${entityId.toUpperCase()}".`,
			);
		}
		return ctx.format.ok({
			entityId: entityId.toUpperCase(),
			kind: embed.kind,
			title: embed.title,
			language: embed.lang,
			html: embed.html,
			...(Array.isArray(embed.languages) && embed.languages.length > 0
				? { languages: embed.languages }
				: {}),
		});
	},
};
