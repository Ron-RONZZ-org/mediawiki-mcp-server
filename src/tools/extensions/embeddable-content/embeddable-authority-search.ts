import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

interface AuthoritySearchResult {
	records?: unknown[];
	warnings?: string[];
}

const inputSchema = {
	kind: z
		.enum(['work', 'person', 'entity', 'software'])
		.describe(
			'What to look up: work (a citation source: book, article, website, film, …), person (an author/creator), entity (a collective/organisation, e.g. a publisher or journal), or software.',
		),
	mode: z
		.enum(['search', 'lookup', 'harvest'])
		.default('search')
		.describe(
			'search (default) finds candidates by name/title; lookup resolves a direct identifier (doi/isbn/orcid/viaf/isni/youtubeUrl); harvest expands a Wikidata Q-id (wikidataId) into the full record, including authors.',
		),
	query: z.string().min(1).optional().describe('Name or title to search for (mode=search).'),
	class: z
		.string()
		.optional()
		.describe(
			'AddSource class key for kind=work (book, scholarly-article, website, webpage, newspaper-article, conference-paper, report, thesis, …). Scopes the Wikidata search. Classes with no external authority (website, transcript, text, law, …) return a warning; use the manual Add* fields for those.',
		),
	author: z
		.string()
		.optional()
		.describe(
			'Author name (or comma-separated Wikidata Q-ids with authorMode=entity) to narrow a work search.',
		),
	authorMode: z
		.enum(['text', 'entity'])
		.default('text')
		.describe('Whether author is a free-text name or Wikidata Q-ids.'),
	doi: z
		.string()
		.optional()
		.describe('DOI (kind=work; direct lookup, Crossref/OpenAlex/Wikidata cascade).'),
	isbn: z.string().optional().describe('ISBN-13 (kind=work; direct lookup).'),
	orcid: z.string().optional().describe('ORCID iD (kind=person; direct lookup).'),
	viaf: z.string().optional().describe('VIAF ID (kind=person; direct lookup).'),
	isni: z.string().optional().describe('ISNI (kind=person; direct lookup).'),
	wikidataId: z
		.string()
		.regex(/^[Qq]\d+$/, 'A Wikidata item ID, such as Q42')
		.optional()
		.describe('Wikidata Q-id for mode=harvest, or a direct work/person/entity lookup.'),
	youtubeUrl: z
		.string()
		.optional()
		.describe('YouTube channel or video URL (kind=work; exact lookup).'),
	url: z
		.string()
		.optional()
		.describe('Website/web-page URL (kind=work, class=website|webpage) to fetch metadata for.'),
	language: z
		.string()
		.default('en')
		.describe('Language for labels and local-item matching (default en).'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(10)
		.default(10)
		.describe('Maximum candidates to return (1–10).'),
	resolveLocal: z
		.boolean()
		.default(false)
		.describe(
			'Add a local block: publisher/journal labels matched against existing items, author records matched by authority ID then label, and person place labels. exact=false marks a fuzzy match to confirm before using its Q-id.',
		),
	fetchPage: z
		.boolean()
		.default(true)
		.describe('For a website/web-page URL, fetch its metadata (default true).'),
} as const;

export const embeddableAuthoritySearch: Tool<typeof inputSchema> = {
	name: 'embeddable-authority-search',
	description:
		"Read-only authority search using the wiki's own AddSource/AddPerson cascade (Wikidata, OpenAlex, Crossref, Open Library, ORCID, dblp, YouTube): finds candidates for a citation source, person, collective, or software, with the same SSRF/rate-limit/class-scope policy as the browser forms. It never writes.\n\nkind=work searches citation sources (use class to scope the Wikidata search; doi/isbn/youtubeUrl/url are direct lookups); kind=person searches authors (orcid/viaf/isni are direct lookups); kind=entity searches collectives/organisations (publishers, journals); kind=software searches software. mode=harvest with a wikidataId expands the selected record (including its authors). resolveLocal=true adds a `local` block with publisher/journal/author/place candidates from this wiki; `exact=false` means a fuzzy match — confirm it before using the Q-id. The response's `suggestedAddFields` can be passed to embeddable-add-citation-source or embeddable-add-semantic-entity after missing author/publisher/journal entities are resolved or created.",
	inputSchema,
	annotations: {
		title: 'Search external authorities',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'search the authority',
	target: (a) =>
		`${a.kind}:${a.query ?? a.doi ?? a.isbn ?? a.orcid ?? a.wikidataId ?? a.url ?? ''}`,

	async handle(
		{
			kind,
			mode,
			query,
			class: classKey,
			author,
			authorMode,
			doi,
			isbn,
			orcid,
			viaf,
			isni,
			wikidataId,
			youtubeUrl,
			url,
			language,
			limit,
			resolveLocal,
			fetchPage,
		},
		ctx: ToolContext,
	): Promise<CallToolResult> {
		const request: Record<string, string> = {
			action: 'authority-search',
			kind,
			mode,
			formatversion: '2',
			language,
			authorMode,
			limit: String(limit),
			resolveLocal: resolveLocal ? '1' : '0',
			fetchPage: fetchPage ? '1' : '0',
		};
		const optional = {
			query,
			class: classKey,
			author,
			doi,
			isbn,
			orcid,
			viaf,
			isni,
			wikidataId,
			youtubeUrl,
			url,
		};
		for (const [key, value] of Object.entries(optional)) {
			if (value !== undefined && value !== '') {
				request[key] = value;
			}
		}

		const mwn = await ctx.mwn();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=authority-search response shape; trusted at this boundary
		const response = (await mwn.request(request)) as { authoritysearch?: AuthoritySearchResult };
		if (response.authoritysearch === undefined) {
			return ctx.format.error(
				'upstream_failure',
				'The wiki did not answer action=authority-search — its EmbeddableContent version predates the module.',
			);
		}
		return ctx.format.ok(response.authoritysearch);
	},
};
