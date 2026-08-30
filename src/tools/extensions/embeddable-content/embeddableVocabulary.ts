import type { Mwn } from 'mwn';
import type { ToolContext } from '../../../runtime/context.ts';

/**
 * Property IDs the EmbeddableContent forms write, keyed by role. The keys
 * match the instance config the extension reads (EmbeddableContentConfig);
 * the IDs are the reference instance's, resolved and verified at runtime.
 */
export interface EmbeddableVocabulary {
	readonly instanceOf: string;
	readonly payloadProperties: Record<'quotation' | 'code' | 'math', string>;
	readonly programmingLanguage: string;
	readonly provenance: Record<'attributedTo' | 'sourceUrl' | 'source' | 'date', string>;
	readonly describes: string;
	readonly implementationOf: string;
	readonly externalIds: Record<
		'wikidataId' | 'doi' | 'isbn13' | 'openalexWorkId' | 'pubmedId',
		string
	>;
	readonly sourceProperties: Record<
		| 'partOf'
		| 'duration'
		| 'youtubeChannelId'
		| 'youtubeVideoId'
		| 'url'
		| 'chapters'
		| 'accessUrl',
		string
	>;
	readonly citationMetadata: Record<'publisher' | 'journal' | 'pages' | 'volume' | 'issue', string>;
}

/** Item IDs of the classes the Add* flows classify items under. */
export interface EmbeddableClasses {
	readonly quotation: string;
	readonly code: string;
	readonly math: string;
	readonly book: string;
	readonly scholarlyArticle: string;
	readonly website: string;
	readonly webpage: string;
	readonly song: string;
	readonly film: string;
	readonly video: string;
	readonly youtubeChannel: string;
	readonly youtubeVideo: string;
	readonly bookExcerpt: string;
}

export interface ResolvedVocabulary {
	readonly vocabulary: EmbeddableVocabulary;
	readonly classes: EmbeddableClasses;
	/** Paths (vocabulary key or class key) that could not be resolved on this wiki. */
	readonly missing: readonly string[];
}

type Path = string;

/**
 * Reference-instance defaults, verified against wikibase.ronzz.org on
 * 2026-08-30. The instance's P-numbers do not match the extension's
 * config-docblock commentary (its own config map is what counts), so these
 * are only the seed for a runtime check: each default ID is read back from
 * the wiki and kept only when its English label matches the expected one.
 * A mismatch is re-resolved by exact-label search, so a differently-seeded
 * instance resolves its own numbering.
 */
const DEFAULT_VOCABULARY: EmbeddableVocabulary = {
	instanceOf: 'P1',
	payloadProperties: { quotation: 'P2', code: 'P3', math: 'P4' },
	programmingLanguage: 'P5',
	provenance: { attributedTo: 'P6', sourceUrl: 'P7', date: 'P8', source: 'P28' },
	describes: 'P29',
	implementationOf: 'P30',
	externalIds: {
		wikidataId: 'P12',
		doi: 'P16',
		isbn13: 'P17',
		openalexWorkId: 'P18',
		pubmedId: 'P19',
	},
	sourceProperties: {
		partOf: 'P44',
		duration: 'P45',
		youtubeChannelId: 'P46',
		youtubeVideoId: 'P47',
		url: 'P48',
		chapters: 'P49',
		accessUrl: 'P55',
	},
	citationMetadata: { publisher: 'P54', journal: 'P57', pages: 'P24', volume: 'P25', issue: 'P26' },
};

const DEFAULT_CLASSES: EmbeddableClasses = {
	quotation: 'Q2',
	code: 'Q3',
	math: 'Q4',
	book: 'Q9',
	scholarlyArticle: 'Q10',
	website: 'Q11',
	webpage: 'Q339',
	song: 'Q12',
	film: 'Q13',
	video: 'Q14',
	youtubeChannel: 'Q337',
	youtubeVideo: 'Q338',
	bookExcerpt: 'Q340',
};

/** path → [default ID, expected English label] for every vocabulary property. */
const PROPERTY_ENTRIES: readonly (readonly [Path, string, string])[] = [
	['instanceOf', 'P1', 'instance of'],
	['payloadProperties.quotation', 'P2', 'content text'],
	['payloadProperties.code', 'P3', 'code source'],
	['payloadProperties.math', 'P4', 'LaTeX source'],
	['programmingLanguage', 'P5', 'programming language'],
	['provenance.attributedTo', 'P6', 'attributed to'],
	['provenance.sourceUrl', 'P7', 'source URL'],
	['provenance.date', 'P8', 'date'],
	['provenance.source', 'P28', 'source'],
	['describes', 'P29', 'describes'],
	['implementationOf', 'P30', 'implementation of'],
	['externalIds.wikidataId', 'P12', 'Wikidata ID'],
	['externalIds.doi', 'P16', 'DOI'],
	['externalIds.isbn13', 'P17', 'ISBN-13'],
	['externalIds.openalexWorkId', 'P18', 'OpenAlex Work ID'],
	['externalIds.pubmedId', 'P19', 'PubMed ID'],
	['sourceProperties.partOf', 'P44', 'part of'],
	['sourceProperties.duration', 'P45', 'duration'],
	['sourceProperties.youtubeChannelId', 'P46', 'YouTube channel ID'],
	['sourceProperties.youtubeVideoId', 'P47', 'YouTube video ID'],
	['sourceProperties.url', 'P48', 'URL'],
	['sourceProperties.chapters', 'P49', 'chapters'],
	['sourceProperties.accessUrl', 'P55', 'access URL'],
	['citationMetadata.publisher', 'P54', 'publisher (entity)'],
	['citationMetadata.journal', 'P57', 'journal (entity)'],
	['citationMetadata.pages', 'P24', 'page(s)'],
	['citationMetadata.volume', 'P25', 'volume'],
	['citationMetadata.issue', 'P26', 'issue'],
];

/** class key → [default ID, expected English label] for every Add* class. */
const CLASS_ENTRIES: readonly (readonly [Path, string, string])[] = [
	['quotation', 'Q2', 'quotation content'],
	['code', 'Q3', 'code snippet'],
	['math', 'Q4', 'mathematical expression'],
	['book', 'Q9', 'book'],
	['scholarlyArticle', 'Q10', 'scholarly article'],
	['website', 'Q11', 'website'],
	['webpage', 'Q339', 'web page'],
	['song', 'Q12', 'song'],
	['film', 'Q13', 'film'],
	['video', 'Q14', 'video'],
	['youtubeChannel', 'Q337', 'YouTube channel'],
	['youtubeVideo', 'Q338', 'YouTube video'],
	['bookExcerpt', 'Q340', 'book excerpt'],
];

interface TermValue {
	value?: string;
}

interface EntityResponse {
	missing?: unknown;
	labels?: Record<string, TermValue | undefined>;
}

/** The English label of an entity, or undefined when the wiki has none. */
function englishLabel(entity: EntityResponse | undefined): string | undefined {
	return typeof entity?.labels?.en?.value === 'string' ? entity.labels.en.value : undefined;
}

/**
 * Resolves the vocabulary by reading each default ID back from the wiki and
 * keeping it only when its English label matches the expected one. A
 * mismatch (a differently-seeded instance) is re-resolved by exact-label
 * search. The result is cached per wiki key.
 */
export async function resolveVocabulary(ctx: ToolContext): Promise<ResolvedVocabulary> {
	const { key } = ctx.activeWiki.get();
	let pending = cache.get(key);
	if (pending === undefined) {
		pending = doResolve(ctx).catch((error) => {
			cache.delete(key);
			throw error;
		});
		cache.set(key, pending);
	}
	return await pending;
}

const cache = new Map<string, Promise<ResolvedVocabulary>>();

/** Test seam: drops the per-wiki cache so a test can stub a fresh resolution. */
export function clearVocabularyCache(): void {
	cache.clear();
}

async function doResolve(ctx: ToolContext): Promise<ResolvedVocabulary> {
	const mwn = await ctx.mwn();

	const resolvedProperties = await resolveByIds(mwn, PROPERTY_ENTRIES, 'property', ctx);
	const resolvedClasses = await resolveByIds(mwn, CLASS_ENTRIES, 'item', ctx);

	const vocabulary = structuredClone(DEFAULT_VOCABULARY);
	for (const [path, id] of resolvedProperties) {
		setPath(vocabulary, path, id);
	}
	const classes = structuredClone(DEFAULT_CLASSES);
	for (const [path, id] of resolvedClasses) {
		setPath(classes, path, id);
	}

	const missing = [
		...PROPERTY_ENTRIES.map(([path]) => path).filter((path) => !resolvedProperties.has(path)),
		...CLASS_ENTRIES.map(([path]) => path).filter((path) => !resolvedClasses.has(path)),
	];

	return { vocabulary, classes, missing };
}

/** Keeps the default ID of every entry whose label verifies; label-searches the rest. */
async function resolveByIds(
	mwn: Mwn,
	entries: readonly (readonly [Path, string, string])[],
	type: 'property' | 'item',
	ctx: ToolContext,
): Promise<Map<Path, string>> {
	const resolved = new Map<Path, string>();
	const unresolved: (readonly [Path, string])[] = [];

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbgetentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbgetentities',
		ids: entries.map(([, id]) => id).join('|'),
		props: 'labels',
		languages: 'en',
		format: 'json',
		formatversion: '2',
	})) as { entities?: Record<string, EntityResponse> };

	const entities = response.entities ?? {};
	for (const [path, id, expectedLabel] of entries) {
		if (englishLabel(entities[id]) === expectedLabel) {
			resolved.set(path, id);
		} else {
			unresolved.push([path, expectedLabel]);
		}
	}

	for (const [path, label] of unresolved) {
		const hit = await searchExactLabel(mwn, label, type);
		if (hit !== undefined) {
			resolved.set(path, hit);
		} else {
			ctx.logger.warning('EmbeddableContent vocabulary entry not resolvable on this wiki', {
				label,
				type,
			});
		}
	}

	return resolved;
}

/** First entity whose English label equals the term exactly, or undefined. */
async function searchExactLabel(
	mwn: Mwn,
	label: string,
	type: 'property' | 'item',
): Promise<string | undefined> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsearchentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbsearchentities',
		search: label,
		language: 'en',
		type,
		limit: 10,
		format: 'json',
		formatversion: '2',
	})) as { search?: { id?: string; label?: string }[] };

	return response.search?.find((result) => result.label === label)?.id;
}

function setPath(target: object, path: string, value: string): void {
	const parts = path.split('.');
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dotted-path writes into a deeply nested object; the intermediate shape is unknown by design
	let node = target as Record<string, unknown>;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = node[parts[i]];
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- intermediate nodes of a dotted path; shape unknown until written
		node = typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : {};
	}
	node[parts[parts.length - 1]] = value;
}
