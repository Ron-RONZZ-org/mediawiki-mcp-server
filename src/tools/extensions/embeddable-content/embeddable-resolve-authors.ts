import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const inputSchema = {
	names: z
		.string()
		.min(1)
		.max(2000)
		.describe(
			'Paste the full author list as one string. Commas only: Given Family, Given Family. Family-first lists: Family, Given; Family, Given. Semicolons only: Given Family; Given Family. With no comma/semicolon, "and"/"&" separate authors.',
		),
	format: z
		.enum(['auto', 'comma', 'semicolon', 'single'])
		.default('auto')
		.describe('How to parse the names. Default auto.'),
	language: z
		.string()
		.regex(/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/i, 'A BCP-47 language code, such as en')
		.default('en')
		.describe('Term language used when resolving the Person labels.'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(25)
		.default(8)
		.describe('Maximum candidate Persons returned per name.'),
} as const;

interface AuthorResolveResponse {
	authorresolve?: {
		input?: string;
		names?: unknown[];
		collectives?: unknown[];
		warnings?: unknown[];
	};
}

export const embeddableResolveAuthors: Tool<typeof inputSchema> = {
	name: 'embeddable-resolve-authors',
	description:
		'Parses a pasted author-name string and resolves every name against the wiki\'s items in ONE read-only call. Returns, per name: the parsed given/family split, flags (mononym, family-first, CJK, parenthetical, et al., …), the local Person candidates with score/authority ids, and any group-of-humans item whose label is itself a person-name list (the legacy "author list stored as a collective" pattern). A name prefixed with ORG: (e.g. ORG:Wikimedia Foundation) is a collective row: it is resolved against the collective agent classes, not Persons. Never accepts a match — every candidate must be confirmed explicitly (common names are ambiguous). Use the result to build the authorDecisions for embeddable-add-citation-source, which creates/reuses the entities and the Source in one write.',
	inputSchema,
	annotations: {
		title: 'Resolve author names',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'resolve author names',
	target: (a) => a.names,

	async handle({ names, format, language, limit }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=authorresolve response shape; trusted at this boundary
		const response = (await mwn.request({
			action: 'authorresolve',
			names,
			nameFormat: format,
			language,
			limit,
			format: 'json',
			formatversion: '2',
		})) as AuthorResolveResponse;
		const result = response?.authorresolve;
		if (result === undefined) {
			return ctx.format.error('upstream_failure', 'The author-resolve API returned no result.');
		}
		return ctx.format.ok(result);
	},
};
