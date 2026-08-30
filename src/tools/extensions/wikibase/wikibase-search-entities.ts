import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import type { TruncationInfo } from '../../../results/truncation.ts';
import { LANGUAGE_CODE, resolveLanguage } from './wikibaseApi.ts';
import { runSparqlBindings, SparqlError } from './sparql.ts';
import { resolveSiteInfo } from '../../../wikis/siteInfo.ts';

const HARD_LIMIT = 50;
const DEFAULT_LIMIT = 10;

/** Property descriptions on large Wikibases run to whole paragraphs. */
const MAX_DESCRIPTION_CHARS = 200;

const inputSchema = {
	query: z
		.string()
		.min(1)
		.describe('Text matched against entity labels and aliases, as typed by a person.'),
	mode: z
		.enum(['prefix', 'contains'])
		.default('prefix')
		.describe(
			"prefix matches labels and aliases that START with the query, exactly as typed — the instance's term store is case-sensitive, so a case mismatch finds nothing. contains matches labels and aliases that CONTAIN the query, case-insensitively, through the wiki's query service; the WDQS index can lag a few minutes behind a freshly-created item, and wikis without a query service cannot answer contains (use prefix there).",
		),
	entityType: z
		.enum(['item', 'property'])
		.default('item')
		.describe('Which kind of entity to look for.'),
	language: z
		.string()
		.regex(LANGUAGE_CODE, 'A single lowercase language code, such as en or pt-br')
		.optional()
		.describe(
			'Language code the search terms and the returned labels are in. Lowercase, as MediaWiki writes them: en-gb, not en-GB. Defaults to the wiki content language.',
		),
	limit: z
		.number()
		.int()
		.min(1)
		.max(HARD_LIMIT)
		.default(DEFAULT_LIMIT)
		.describe('Maximum matches to return.'),
} as const;

interface SearchMatch {
	id?: string;
	label?: string;
	description?: string;
	datatype?: string;
	match?: { type?: string; text?: string };
}

export const wikibaseSearchEntities: Tool<typeof inputSchema> = {
	name: 'wikibase-search-entities',
	description:
		"Finds Wikibase items and properties by label or alias on the targeted wiki, returning one `id — label — description` line per match. Enabled only when the wiki is a Wikibase repository.\n\nEntity IDs are wiki-specific: the same concept has different Q-ids on Wikidata and on a private Wikibase, so IDs are discovered here rather than recalled. Properties carry their datatype in brackets, which tells wikibase-add-statement what a value for them looks like.\n\nMatching is prefix-based by default: it finds entities whose name starts with the terms, not entities that mention them, and the instance term store is case-sensitive — 0 hits proves nothing about entities whose names merely contain the query. Set mode=contains for a case-insensitive substring match over labels and aliases (requires the wiki's query service; the WDQS index can lag a few minutes behind a freshly-created item). To select entities by their statements, use wikibase-query; to read an entity's statements, use wikibase-get-entity.",
	inputSchema,
	annotations: {
		title: 'Search Wikibase entities',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'search Wikibase entities',
	target: (a) => a.query,

	async handle(
		{ query, mode, entityType, language, limit },
		ctx: ToolContext,
	): Promise<CallToolResult> {
		if (mode === 'contains') {
			return searchContains(ctx, query, entityType, language, limit);
		}

		const searchLanguage = await resolveLanguage(ctx, language);
		const mwn = await ctx.mwn();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsearchentities response shape; trusted at this boundary
		const response = (await mwn.request({
			action: 'wbsearchentities',
			search: query,
			language: searchLanguage,
			uselang: searchLanguage,
			type: entityType,
			limit,
			format: 'json',
			formatversion: '2',
		})) as { search?: SearchMatch[]; 'search-continue'?: unknown };

		const matches = response.search ?? [];
		const results = matches.filter((match) => typeof match.id === 'string').map(renderMatch);

		// The API reports the offset it would resume from, which is the exact answer
		// to "were there more": a full page is not evidence of one.
		const truncation: TruncationInfo | null =
			typeof response['search-continue'] === 'number'
				? {
						reason: 'capped-no-continuation',
						returnedCount: results.length,
						limit,
						itemNoun: 'matches',
						narrowHint: `use more of the entity's name, or raise limit (max ${HARD_LIMIT}).`,
					}
				: null;

		return ctx.format.ok({
			results,
			...(truncation !== null ? { truncation } : {}),
		});
	},
};

function renderMatch(match: SearchMatch): string {
	const parts = [match.id, match.label].filter((part) => part !== undefined && part !== '');
	const description = clamp(match.description);
	if (description !== undefined) {
		parts.push(description);
	}
	let line = parts.join(' — ');
	if (match.datatype !== undefined) {
		line += ` [${match.datatype}]`;
	}
	// Naming the alias explains a match whose label looks unrelated to the query.
	if (match.match?.type === 'alias' && match.match.text !== undefined) {
		line += ` (matched alias: ${match.match.text})`;
	}
	return line;
}

// The budget counts code points rather than UTF-16 units, so a cut landing
// inside an astral character such as an emoji does not leave half of one behind.
function clamp(description: string | undefined): string | undefined {
	if (description === undefined || description === '') {
		return undefined;
	}
	const characters = Array.from(description);
	return characters.length > MAX_DESCRIPTION_CHARS
		? `${characters.slice(0, MAX_DESCRIPTION_CHARS).join('')}…`
		: description;
}

/**
 * Case-insensitive substring search over labels and aliases, via the query
 * service: wbsearchentities on a MySQL term store matches prefixes only (and
 * case-sensitively), so `contains` is the only way to ask "which entities
 * MENTION this text" — and to prove absence. The WDQS index can lag a few
 * minutes behind a fresh entity, which the description says.
 */
async function searchContains(
	ctx: ToolContext,
	query: string,
	entityType: 'item' | 'property',
	language: string | undefined,
	limit: number,
): Promise<CallToolResult> {
	const { key } = ctx.activeWiki.get();
	const endpoint = ((await resolveSiteInfo(ctx, key)).sparqlEndpoint ?? '').trim();
	if (endpoint === '') {
		return ctx.format.invalidInput(
			`Wiki "${key}" advertises no query service, so contains search cannot run against it. Use mode=prefix instead.`,
		);
	}

	const searchLanguage = await resolveLanguage(ctx, language);
	// Properties carry wikibase:propertyType; items do not — the standard way
	// to separate the two kinds in SPARQL.
	const typePattern =
		entityType === 'property'
			? '?item wikibase:propertyType ?propType .'
			: 'FILTER NOT EXISTS { ?item wikibase:propertyType ?propType } .';
	const languageLiteral = sparqlLiteral(searchLanguage);
	// The entity IRI is $wgServer/entity/Q… (Wikibase's default entity URL);
	// STRAFTER keeps the bare id. A wiki that deviates would bind '' here and
	// the rows would be dropped below — a visible empty result, not a crash.
	const sparql = `SELECT DISTINCT ?id ?label ?description WHERE {
  { ?item rdfs:label ?label . }
  UNION
  { ?item skos:altLabel ?label . }
  ${typePattern}
  FILTER(CONTAINS(LCASE(?label), LCASE(${sparqlLiteral(query)})))
  FILTER(LANG(?label) = ${languageLiteral} || LANG(?label) = "")
  OPTIONAL {
    ?item schema:description ?description .
    FILTER(LANG(?description) = ${languageLiteral})
  }
  BIND(STRAFTER(STR(?item), '/entity/') AS ?id)
} ORDER BY ?label LIMIT ${limit}`;

	let results;
	try {
		results = await runSparqlBindings(endpoint, sparql, limit);
	} catch (err) {
		if (err instanceof SparqlError) {
			return ctx.format.error(err.category, err.message);
		}
		throw err;
	}

	const matches = results.rows
		.filter((row) => /^[QqPp]\d+$/.test(row.id))
		.map((row) => ({
			id: row.id,
			label: row.label,
			...(row.description !== '' ? { description: row.description } : {}),
		}));

	return ctx.format.ok({
		results: matches.map(renderMatch),
	});
}

/** A SPARQL string literal, escaping the characters a literal cannot carry. */
function sparqlLiteral(value: string): string {
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')}"`;
}
