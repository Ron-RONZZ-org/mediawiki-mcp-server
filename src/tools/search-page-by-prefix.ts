import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import type { TruncationInfo } from '../results/truncation.ts';
import { resolveSiteInfo } from '../wikis/siteInfo.ts';

interface AllPagesEntry {
	pageid: number;
	ns: number;
	title: string;
}

type PrefixResolution = { apprefix: string; apnamespace?: number } | { error: string };

const inputSchema = {
	prefix: z
		.string()
		.describe(
			'Wiki page title prefix. A prefix that names a namespace — "RonzzIT:" or "RonzzIT:Main" — is resolved to that namespace: the call lists the namespace (colon alone) or its titles beginning with the remainder. An unknown trailing-colon prefix is an error naming the fix.',
		),
	limit: z
		.number()
		.int()
		.min(1)
		.max(500)
		.optional()
		.describe('Maximum number of results to return'),
	namespace: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe(
			'Namespace ID to restrict the search to. Mutually exclusive with a namespace-style prefix.',
		),
} as const;

export const searchPageByPrefix: Tool<typeof inputSchema> = {
	name: 'search-page-by-prefix',
	description:
		'Returns wiki page titles beginning with a given prefix (suited to autocomplete and title lookup). Only titles are returned — no snippets, sizes, or IDs. Accepts up to 500 titles per call (default 10); additional matches beyond the cap are flagged in the response. A prefix that names a namespace — "RonzzIT:" lists the whole namespace, "RonzzIT:Main" lists its titles starting with "Main" — is resolved against the wiki\'s namespaces, so the colon form works where the API alone would reject it. For full-text content search, use search-page.',
	inputSchema,
	annotations: {
		title: 'Search page by prefix',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'retrieve search data',
	target: (a) => a.prefix,

	async handle({ prefix, limit, namespace }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();

		// allpages rejects any colon-prefix whose first segment is a registered
		// namespace other than apnamespace (invalidtitle "Bad title ..."), so a
		// "Namespace:"-style prefix must be translated before the request.
		let apprefix = prefix;
		let apnamespace = namespace;
		if (prefix.includes(':')) {
			const resolved = await resolvePrefixNamespace(ctx, prefix, namespace);
			if ('error' in resolved) {
				return ctx.format.invalidInput(resolved.error);
			}
			apprefix = resolved.apprefix;
			apnamespace = resolved.apnamespace;
		}

		const params: Record<string, string | number | boolean> = {
			action: 'query',
			list: 'allpages',
			apprefix,
			formatversion: '2',
		};
		if (limit !== undefined) {
			params.aplimit = limit;
		}
		if (apnamespace !== undefined) {
			params.apnamespace = apnamespace;
		}

		const response = await mwn.request(params);
		const pages: AllPagesEntry[] = response.query?.allpages ?? [];

		const truncation: TruncationInfo | null = response.continue
			? {
					reason: 'capped-no-continuation',
					returnedCount: pages.length,
					limit: limit ?? 10,
					itemNoun: 'titles',
					narrowHint: 'narrow the prefix or raise limit (max 500)',
				}
			: null;

		return ctx.format.ok({
			results: pages.map((p) => ({
				title: p.title,
				pageId: p.pageid,
				namespace: p.ns,
			})),
			...(truncation !== null ? { truncation } : {}),
		});
	},
};

/**
 * Turns a colon-containing prefix into the allpages parameters the API will
 * accept. A first segment that is a registered namespace (matched
 * case-insensitively, including localized names and aliases) becomes the
 * `apnamespace`, with the remainder as the title prefix — empty for a bare
 * "Namespace:" listing. A first segment that is not a namespace is a plain
 * main-namespace title containing a colon, passed through; only a trailing
 * colon with no namespace behind it is rejected, with the fix named.
 */
async function resolvePrefixNamespace(
	ctx: ToolContext,
	prefix: string,
	namespace: number | undefined,
): Promise<PrefixResolution> {
	const colon = prefix.indexOf(':');
	const nsPart = prefix.slice(0, colon);
	const rest = prefix.slice(colon + 1);

	const { key } = ctx.activeWiki.get();
	const siteInfo = await resolveSiteInfo(ctx, key);
	const nsId = siteInfo.namespaceNames?.[nsPart.toLowerCase()];

	if (nsId !== undefined) {
		if (namespace !== undefined && namespace !== nsId) {
			return {
				error: `prefix "${prefix}" names namespace ${nsId} but the namespace parameter is ${namespace}. Pass one or the other.`,
			};
		}
		return { apprefix: rest, apnamespace: nsId };
	}

	if (rest === '') {
		return {
			error: `prefix "${prefix}" ends in a colon but "${nsPart}" is not a namespace on this wiki. Pass the namespace parameter, or strip the colon and use prefix="${nsPart}".`,
		};
	}
	return { apprefix: prefix };
}
