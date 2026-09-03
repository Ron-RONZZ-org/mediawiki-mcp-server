import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { SOURCE_CLASS_KEYS, SOURCE_FIELDS } from './embeddableSchema.ts';
import { ITEM_ID } from './embeddableWrite.ts';
import {
	duplicateHitOf,
	duplicateHitResult,
	unresolvedWriteResult,
} from './embeddableAddOutcome.ts';

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
			"Comma/semicolon-separated item IDs of the authors or creators (agent-class items, e.g. Q6 person items). At least one is required when creating, except for book-excerpt, which copies the parent book's authors when left blank. Resolve names with wikibase-search-entities first.",
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
	confirmDuplicate: z
		.boolean()
		.optional()
		.describe(
			"Set true to create the item anyway when the wiki's duplication guard flags an existing item (the same authority id or URL, or a highly similar class-filtered label) as a duplicate of the record. The create is otherwise refused and the existing item returned instead. Forces the create; can produce a second item for the same work.",
		),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

export const embeddableAddCitationSource: Tool<typeof inputSchema> = {
	name: 'embeddable-add-citation-source',
	description:
		"Creates or updates a citable work item on a wiki with the EmbeddableContent extension, mirroring the Special:AddSource flow, and returns the item ID and latest revision. Requires the edit right. The item is classified under the classKey's class (book, scholarly-article, website, webpage, song, film, video, youtube-channel, youtube-video, book-excerpt) and carries the class's fields as statements — authors as attributed to statements (at least one, as item IDs), publisher and journal as item values, year on the date property at year precision, duration as whole seconds.\n\nThe item is created by the wiki's own AddSource service (action=addsource), so validation, statement building and the classic Source: page + sitelink are identical to the form; a class that does not expose a field rejects it, and the child classes require a parent of the right class. A book-excerpt with blank year or authors copies them from the parent book. A create that matches an existing item (the same authority id or URL, or a highly similar class-filtered label) is refused by the wiki's duplication guard, which returns the existing item instead of creating — cite or update that item, or set confirmDuplicate to force the create. When the wiki's response is lost and no item comes back, the tool checks whether an item with the submitted title exists and reports the outcome before you retry.\n\nSet qid to update an existing item instead: statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed. For the field table, property IDs and a ready-to-submit example, call embeddable-describe-entity-type first. Cite the created item on pages with {{#cite:Qxx}} (see the wiki's Help:Contributing/citations).",
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
		const mwn = await ctx.mwn();

		// The wiki's action=addsource module is the single implementation of
		// the flow: field exposure, validation, statement building, the
		// classic Source: page and the sitelink all live there. This tool
		// only marshals the arguments and renders the result.
		const params: Record<string, string> = { action: 'addsource', class: args.classKey };
		for (const field of SOURCE_FIELDS) {
			const value = args[field];
			if (value !== undefined && value !== '') {
				params[field] = value;
			}
		}
		if (args.qid !== undefined) {
			params.qid = args.qid.toUpperCase();
		}
		if (args.confirmDuplicate === true) {
			params.confirmDuplicate = '1';
		}
		if (args.comment !== undefined && args.comment !== '') {
			params.summary = args.comment;
		}

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=addsource response shape; trusted at this boundary
		const response = (await ctx.edit.submit(mwn, params)) as {
			source?: {
				entityId?: string;
				entityType?: string;
				latestRevisionId?: number;
				created?: boolean | string;
				updated?: boolean | string;
				pageTitle?: string;
				duplicate?: boolean | string;
				duplicateOf?: string;
				duplicateLabel?: string;
				match?: string;
			};
		};

		const source = response?.source;
		if (source?.entityId === undefined) {
			// The wiki answered without creating: a duplication-guard refusal
			// names the existing item; anything else is a lost response whose
			// outcome is checked before the caller is told to retry.
			const duplicate = duplicateHitOf(source);
			if (duplicate !== undefined) {
				return duplicateHitResult(ctx, duplicate);
			}
			return unresolvedWriteResult(ctx, {
				noun: 'citation source',
				mode: args.qid === undefined ? 'create' : 'update',
				label: args.title,
				qid: args.qid?.toUpperCase(),
			});
		}
		return ctx.format.ok({
			entityId: source.entityId,
			entityType: source.entityType,
			latestRevisionId: source.latestRevisionId,
			...(source.created === true || source.created === '1' ? { created: true } : {}),
			...(source.updated === true || source.updated === '1' ? { updated: true } : {}),
			...(typeof source.pageTitle === 'string' ? { pageTitle: source.pageTitle } : {}),
		});
	},
};
