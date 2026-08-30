import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import type { EmbeddableClasses, EmbeddableVocabulary } from './embeddableVocabulary.ts';
import { resolveVocabulary } from './embeddableVocabulary.ts';
import {
	CLASS_FIELDS,
	CLASS_KEY_TO_VOCAB,
	PARENT_CLASS,
	SOURCE_CLASS_KEYS,
	SOURCE_FIELD_PATH,
	SOURCE_FIELDS,
} from './embeddableSchema.ts';
import type { SourceClassKey, SourceField } from './embeddableSchema.ts';

type ClassKey = SourceClassKey;
import {
	ITEM_ID,
	editSummary,
	entityStatement,
	mergeClaims,
	parseDurationSeconds,
	parseYear,
	quantityStatement,
	readEntity,
	splitItemIds,
	stringStatement,
	submitEntityWrite,
	yearStatement,
	isHttpUrl,
} from './embeddableWrite.ts';

const inputSchema = {
	classKey: z
		.enum(SOURCE_CLASS_KEYS)
		.describe(
			'The kind of work, matching the Special:AddSource class picker: book, scholarly-article, website, webpage, song, film, video, youtube-channel, youtube-video or book-excerpt. Child classes (webpage, youtube-video, book-excerpt) require their parent class item via parent.',
		),
	title: z
		.string()
		.min(1)
		.max(250)
		.optional()
		.describe("The work's title; becomes the item label. Required when creating."),
	description: z
		.string()
		.max(2000)
		.optional()
		.describe("A short description; becomes the item's English description."),
	authors: z
		.string()
		.optional()
		.describe(
			"Comma/semicolon-separated item IDs of the authors or creators (Q6 person items). At least one is required when creating, except for book-excerpt, which copies the parent book's authors when left blank. Resolve names with wikibase-search-entities first.",
		),
	publisher: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe(
			'The publisher, as an item ID (entity-only on this flow). Accepted for book and scholarly-article.',
		),
	journal: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe('The journal, as an item ID (entity-only). Accepted for scholarly-article only.'),
	volume: z.string().optional().describe('Volume (scholarly-article, book-excerpt).'),
	issue: z.string().optional().describe('Issue (scholarly-article only).'),
	pages: z
		.string()
		.optional()
		.describe('Page range or count (book, scholarly-article, book-excerpt).'),
	chapters: z.string().optional().describe('Chapter count or range (book-excerpt only).'),
	year: z
		.string()
		.regex(/^\d{4}$/, 'A four-digit year, such as 1843')
		.optional()
		.describe(
			'Publication or creation year; stored on the date property at year precision. Omitted on website (dynamic).',
		),
	isbn: z.string().optional().describe('ISBN-13 (book only).'),
	doi: z.string().optional().describe('DOI (scholarly-article only).'),
	wikidataId: z
		.string()
		.optional()
		.describe(
			'The corresponding Wikidata entity ID, e.g. Q571, stored as a Wikidata ID statement.',
		),
	openalexWorkId: z
		.string()
		.optional()
		.describe('OpenAlex Work ID, stored bare (scholarly-article).'),
	pubmedId: z.string().optional().describe('PubMed ID (scholarly-article).'),
	url: z
		.string()
		.optional()
		.describe("The work's URL (website, webpage, video, youtube-channel, youtube-video)."),
	duration: z
		.string()
		.optional()
		.describe(
			'Runtime as MM:SS or HH:MM:SS, stored as whole seconds (song, film, video, youtube-video).',
		),
	youtubeChannelId: z.string().optional().describe('The channel ID, e.g. UC… (youtube-channel).'),
	youtubeVideoId: z.string().optional().describe('The video ID (youtube-video).'),
	accessUrl: z
		.string()
		.optional()
		.describe(
			'A non-direct access URL for the work (book, scholarly-article, song, film, book-excerpt).',
		),
	parent: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe(
			'The parent-class item, written as a part of statement: the website for a webpage, the channel for a youtube-video, the book for a book-excerpt. Required when creating those classes; must be an existing item of the parent class.',
		),
	qid: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q96')
		.optional()
		.describe(
			'Set to update an existing source item instead of creating one. Statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed.',
		),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

interface SourceArgs {
	classKey: ClassKey;
	title?: string;
	description?: string;
	authors?: string;
	publisher?: string;
	journal?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	chapters?: string;
	year?: string;
	isbn?: string;
	doi?: string;
	wikidataId?: string;
	openalexWorkId?: string;
	pubmedId?: string;
	url?: string;
	duration?: string;
	youtubeChannelId?: string;
	youtubeVideoId?: string;
	accessUrl?: string;
	parent?: string;
	qid?: string;
	comment?: string;
}

interface NormalizedSource {
	authors: string[];
	year?: number;
	durationSeconds?: number;
	parent?: string;
	parentLabel?: string;
	parentYear?: number;
	parentAuthors: string[];
}

export const embeddableAddCitationSource: Tool<typeof inputSchema> = {
	name: 'embeddable-add-citation-source',
	description:
		"Creates or updates a citable work item on a wiki with the EmbeddableContent extension, mirroring the Special:AddSource flow, and returns the item ID and latest revision. Requires the edit right. The item is classified under the classKey's class (book, scholarly-article, website, webpage, song, film, video, youtube-channel, youtube-video, book-excerpt) and carries the class's fields as statements — authors as attributed to statements (at least one, as item IDs), publisher and journal as item values, year on the date property at year precision, duration as whole seconds.\n\nChild classes require parent, the existing parent-class item (website for webpage, youtube-channel for youtube-video, book for book-excerpt); the link is written as a part of statement. A book-excerpt with blank year or authors copies them from the parent book. Only the fields the class exposes are accepted; passing a field another class owns errors the call.\n\nSet qid to update an existing item instead: statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed. For the field table, property IDs and a ready-to-submit example, call embeddable-describe-entity-type first. Cite the created item on pages with {{#cite:Qxx}} (see the wiki's Help:Contributing/citations).",
	inputSchema,
	annotations: {
		title: 'Add citation source',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'add citation source',
	target: (a) => a.qid ?? a.title ?? a.classKey,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const { vocabulary, classes, missing } = await resolveVocabulary(ctx);
		const classKey = args.classKey;

		const provided = providedFields(args);
		const disallowed = [...provided].filter((field) => !CLASS_FIELDS[classKey].has(field));
		if (disallowed.length > 0) {
			return ctx.format.invalidInput(
				`classKey ${classKey} does not expose the field(s) ${disallowed.join(', ')}. Its fields are ${[
					...CLASS_FIELDS[classKey],
				].join(', ')}.`,
			);
		}

		const needed = [
			'instanceOf',
			`classes.${CLASS_KEY_TO_VOCAB[classKey]}`,
			'provenance.attributedTo',
			'provenance.date',
		];
		for (const field of provided) {
			const path = SOURCE_FIELD_PATH[field];
			if (path !== undefined) {
				needed.push(path);
			}
		}
		const absent = needed.filter((key) => missing.includes(key));
		if (absent.length > 0) {
			return ctx.format.error(
				'upstream_failure',
				`This wiki is missing EmbeddableContent vocabulary entries (${absent.join(', ')}) that embeddable-add-citation-source needs. Check the extension's configuration.`,
			);
		}

		const creating = args.qid === undefined;
		const normalized = await validateSource(ctx, args, classKey, vocabulary, classes, creating);
		if (normalized instanceof Error) {
			return ctx.format.invalidInput(normalized.message);
		}

		const additions = buildSourceClaims(args, vocabulary, normalized);

		if (args.qid !== undefined) {
			return updateExistingSource(ctx, args.qid, args, additions);
		}
		return createNewSource(ctx, args, vocabulary, classes, classKey, additions, normalized);
	},
};

function providedFields(args: SourceArgs): Set<SourceField> {
	return new Set(SOURCE_FIELDS.filter((field) => args[field] !== undefined && args[field] !== ''));
}

async function validateSource(
	ctx: ToolContext,
	args: SourceArgs,
	classKey: ClassKey,
	vocabulary: EmbeddableVocabulary,
	classes: EmbeddableClasses,
	creating: boolean,
): Promise<NormalizedSource | Error> {
	if (creating && args.title === undefined) {
		return new Error('title is required when creating a source item.');
	}

	const authors = splitItemIds(args.authors);
	if (authors === null) {
		return new Error('authors must be comma/semicolon-separated item IDs.');
	}

	let year: number | undefined;
	if (args.year !== undefined) {
		const parsed = parseYear(args.year);
		if (parsed === null) {
			return new Error(`year "${args.year}" is not a four-digit year.`);
		}
		year = parsed;
	}

	let durationSeconds: number | undefined;
	if (args.duration !== undefined) {
		const parsed = parseDurationSeconds(args.duration);
		if (parsed === null) {
			return new Error(`duration "${args.duration}" is not MM:SS or HH:MM:SS.`);
		}
		durationSeconds = parsed;
	}

	for (const urlField of ['url', 'accessUrl'] as const) {
		const value = args[urlField];
		if (value !== undefined && !isHttpUrl(value)) {
			return new Error(`${urlField} "${value}" is not an http(s) URL.`);
		}
	}

	// Child classes require an existing parent of the expected class.
	let parent: string | undefined;
	let parentLabel: string | undefined;
	let parentYear: number | undefined;
	let parentAuthors: string[] = [];
	const expectedParentClass = PARENT_CLASS[classKey];
	if (expectedParentClass !== undefined && (creating || args.parent !== undefined)) {
		if (args.parent === undefined) {
			return new Error(
				`classKey ${classKey} requires parent: an existing item of class ${expectedParentClass}.`,
			);
		}
		parent = args.parent.toUpperCase();
		const mwn = await ctx.mwn();
		const existing = await readEntity(mwn, parent);
		if (existing === undefined) {
			return new Error(`parent "${parent}" does not exist.`);
		}
		const parentClassId = classes[expectedParentClass];
		const hasClass = existing.claims.some(
			(s) =>
				s.mainsnak.property === vocabulary.instanceOf &&
				s.mainsnak.datavalue?.type === 'wikibase-entityid' &&
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wikibase-entityid value shape; trusted at this boundary
				(s.mainsnak.datavalue.value as { id?: string }).id === parentClassId,
		);
		if (!hasClass) {
			return new Error(`parent "${parent}" is not an item of class ${expectedParentClass}.`);
		}
		parentLabel = existing.labels?.en?.value;
		parentYear = firstYear(existing.claims, vocabulary.provenance.date);
		parentAuthors = existing.claims
			.filter((s) => s.mainsnak.property === vocabulary.provenance.attributedTo)
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- entity-id datavalue shape; trusted at this boundary
			.map((s) => (s.mainsnak.datavalue.value as { id?: string }).id)
			.filter((id): id is string => id !== undefined);
	}

	if (creating && classKey !== 'book-excerpt' && authors.length === 0) {
		return new Error(
			'At least one author item ID is required. Resolve author names with wikibase-search-entities and pass the item IDs.',
		);
	}

	return {
		authors,
		parentAuthors,
		...(year !== undefined ? { year } : {}),
		...(durationSeconds !== undefined ? { durationSeconds } : {}),
		...(parent !== undefined ? { parent, parentLabel, parentYear } : {}),
	};
}

function buildSourceClaims(
	args: SourceArgs,
	vocabulary: EmbeddableVocabulary,
	normalized: NormalizedSource,
): ReturnType<typeof entityStatement>[] {
	const v = vocabulary;
	const claims: ReturnType<typeof entityStatement>[] = [];

	// Authors the caller gave, or (book-excerpt) the parent book's authors.
	const authors = normalized.authors.length > 0 ? normalized.authors : normalized.parentAuthors;
	for (const id of authors) {
		claims.push(entityStatement(v.provenance.attributedTo, id));
	}

	if (args.publisher !== undefined) {
		claims.push(entityStatement(v.citationMetadata.publisher, args.publisher));
	}
	if (args.journal !== undefined) {
		claims.push(entityStatement(v.citationMetadata.journal, args.journal));
	}
	for (const [field, property] of [
		['volume', v.citationMetadata.volume],
		['issue', v.citationMetadata.issue],
		['pages', v.citationMetadata.pages],
		['chapters', v.sourceProperties.chapters],
	] as const) {
		const value = args[field];
		if (value !== undefined && value !== '') {
			claims.push(stringStatement(property, value));
		}
	}

	const year = normalized.year ?? normalized.parentYear;
	if (year !== undefined) {
		claims.push(yearStatement(v.provenance.date, year));
	}

	for (const [field, property] of [
		['isbn', v.externalIds.isbn13],
		['doi', v.externalIds.doi],
		['wikidataId', v.externalIds.wikidataId],
		['openalexWorkId', v.externalIds.openalexWorkId],
		['pubmedId', v.externalIds.pubmedId],
		['url', v.sourceProperties.url],
		['youtubeChannelId', v.sourceProperties.youtubeChannelId],
		['youtubeVideoId', v.sourceProperties.youtubeVideoId],
		['accessUrl', v.sourceProperties.accessUrl],
	] as const) {
		const value = args[field];
		if (value !== undefined && value !== '') {
			claims.push(stringStatement(property, value));
		}
	}

	if (normalized.durationSeconds !== undefined) {
		claims.push(quantityStatement(v.sourceProperties.duration, normalized.durationSeconds));
	}
	if (normalized.parent !== undefined) {
		claims.push(entityStatement(v.sourceProperties.partOf, normalized.parent));
	}
	return claims;
}

async function createNewSource(
	ctx: ToolContext,
	args: SourceArgs,
	vocabulary: EmbeddableVocabulary,
	classes: EmbeddableClasses,
	classKey: ClassKey,
	additions: ReturnType<typeof entityStatement>[],
	normalized: NormalizedSource,
): Promise<CallToolResult> {
	const instanceOf = entityStatement(vocabulary.instanceOf, classes[CLASS_KEY_TO_VOCAB[classKey]]);

	const data: Record<string, unknown> = {
		labels: { en: { language: 'en', value: args.title } },
		claims: [instanceOf, ...additions],
	};
	const description = descriptionFor(args, normalized);
	if (description !== undefined) {
		data.descriptions = { en: { language: 'en', value: description } };
	}

	const summary = editSummary(ctx, 'embeddable-add-citation-source', args.comment);
	const saved = await submitEntityWrite(ctx, {
		new: 'item',
		data: JSON.stringify(data),
		...(summary !== undefined ? { summary } : {}),
	});
	if (saved === undefined) {
		return ctx.format.error(
			'upstream_failure',
			'The wiki accepted the request but returned no entity.',
		);
	}
	return ctx.format.ok({
		entityId: saved.entityId,
		entityType: saved.entityType,
		latestRevisionId: saved.latestRevisionId,
		created: true,
	});
}

/**
 * The book-excerpt description auto-generates as "Pages a-b (Volume c) of
 * {book}" when left blank and a parent is present, matching the form.
 */
function descriptionFor(args: SourceArgs, normalized: NormalizedSource): string | undefined {
	if (args.description !== undefined && args.description !== '') {
		return args.description;
	}
	if (args.classKey !== 'book-excerpt' || normalized.parentLabel === undefined) {
		return undefined;
	}
	const parts: string[] = [];
	if (args.pages !== undefined && args.pages !== '') {
		parts.push(`Pages ${args.pages}`);
	}
	if (args.volume !== undefined && args.volume !== '') {
		parts.push(`Volume ${args.volume}`);
	}
	return parts.length > 0 ? `${parts.join(' ')} of ${normalized.parentLabel}` : undefined;
}

async function updateExistingSource(
	ctx: ToolContext,
	qid: string,
	args: SourceArgs,
	additions: ReturnType<typeof entityStatement>[],
): Promise<CallToolResult> {
	const id = qid.toUpperCase();
	const mwn = await ctx.mwn();
	const existing = await readEntity(mwn, id);
	if (existing === undefined) {
		return ctx.format.notFound(`Entity "${id}" not found`);
	}

	const managed = new Set(additions.map((s) => s.mainsnak.property));
	const claims = mergeClaims(existing.claims, managed, additions);

	const data: Record<string, unknown> = { claims };
	if (args.title !== undefined) {
		data.labels = { en: { language: 'en', value: args.title } };
	}
	if (args.description !== undefined && args.description !== '') {
		data.descriptions = { en: { language: 'en', value: args.description } };
	}
	const summary = editSummary(ctx, 'embeddable-add-citation-source', args.comment);
	const saved = await submitEntityWrite(ctx, {
		id,
		data: JSON.stringify(data),
		...(summary !== undefined ? { summary } : {}),
	});
	if (saved === undefined) {
		return ctx.format.error(
			'upstream_failure',
			'The wiki accepted the request but returned no entity.',
		);
	}
	return ctx.format.ok({
		entityId: saved.entityId,
		entityType: saved.entityType,
		latestRevisionId: saved.latestRevisionId,
		updated: true,
	});
}

/** The first date statement value as a year, used for book-excerpt inference. */
function firstYear(
	claims: readonly {
		mainsnak: { property: string; datavalue?: { value?: unknown } };
	}[],
	dateProperty: string,
): number | undefined {
	for (const s of claims) {
		if (s.mainsnak.property !== dateProperty) {
			continue;
		}
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- time datavalue shape; trusted at this boundary
		const time = (s.mainsnak.datavalue?.value as { time?: string } | undefined)?.time;
		if (typeof time === 'string') {
			const year = Number(time.slice(1, 5));
			if (Number.isFinite(year)) {
				return year;
			}
		}
	}
	return undefined;
}
