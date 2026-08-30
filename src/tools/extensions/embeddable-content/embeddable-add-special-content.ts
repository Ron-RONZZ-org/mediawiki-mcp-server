import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import type { Mwn } from 'mwn';
import type { EmbeddableClasses, EmbeddableVocabulary } from './embeddableVocabulary.ts';
import { resolveVocabulary } from './embeddableVocabulary.ts';
import { PAYLOAD_KEY, SPECIAL_CONTENT_KINDS } from './embeddableSchema.ts';
import type { SpecialContentKind } from './embeddableSchema.ts';
import {
	DAY_DATE,
	ITEM_ID,
	LANGUAGE_CODE,
	dayStatement,
	editSummary,
	entityStatement,
	mergeClaims,
	monolingualStatement,
	parseDayDate,
	readEntity,
	splitItemIds,
	stringStatement,
	stripMathDelimiters,
	submitEntityWrite,
	isHttpUrl,
} from './embeddableWrite.ts';

const KINDS = SPECIAL_CONTENT_KINDS;
type Kind = SpecialContentKind;

const inputSchema = {
	kind: z
		.enum(KINDS)
		.describe(
			'What the item holds: quotation (a quote with language), math (LaTeX source), or code-snippet (source code).',
		),
	label: z
		.string()
		.min(1)
		.max(250)
		.optional()
		.describe(
			'A short title for the item, e.g. "E = mc²" or the quotation\'s first words. Required when creating; on update it replaces the label in labelLanguage.',
		),
	content: z
		.string()
		.min(1)
		.optional()
		.describe(
			'The payload: the quotation text (quotation), LaTeX source (math — enclosing $…$, $$…$$, \\(…\\) or \\[…\\] delimiters are stripped on save), or the source code (code-snippet). Required when creating.',
		),
	labelLanguage: z
		.string()
		.regex(LANGUAGE_CODE, 'A single lowercase language code, such as en or fr')
		.optional()
		.describe('Language code for the label. Defaults to en.'),
	language: z
		.string()
		.regex(LANGUAGE_CODE, 'A single lowercase language code, such as en or fr')
		.optional()
		.describe(
			'Language code of the quotation text. Accepted for kind=quotation only; ignored otherwise. Defaults to en.',
		),
	programmingLanguage: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Accepted for kind=code-snippet only: the programming language, as an item ID (Q57) or an English label resolved against the wiki\'s items (e.g. "Python").',
		),
	describes: z
		.string()
		.optional()
		.describe(
			'Accepted for kind=math only: comma/semicolon-separated item IDs (Q99) for the concepts the expression is about. Each element must be an item ID; any invalid element errors the call.',
		),
	implementationOf: z
		.string()
		.optional()
		.describe(
			'Accepted for kind=code-snippet only: comma/semicolon-separated item IDs for the algorithm or concept the code implements. Same strictness as describes.',
		),
	attributedTo: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q94')
		.optional()
		.describe(
			'The person or work the content is attributed to. Required for quotations, optional otherwise.',
		),
	source: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q96')
		.optional()
		.describe('The book or article this item is cited from, as an item ID.'),
	sourceUrl: z
		.string()
		.optional()
		.describe('The page or document this content comes from, as an http(s) URL.'),
	date: z
		.string()
		.regex(DAY_DATE, 'A calendar date in YYYY-MM-DD form')
		.optional()
		.describe('When the content was created or published, as YYYY-MM-DD at day precision.'),
	qid: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q100')
		.optional()
		.describe(
			'Set to update an existing item instead of creating one. Managed statements (payload, provenance, subject fields) are replaced for fields provided here; blank fields keep the existing statements, and the class is never changed.',
		),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

interface ItemWriteArgs {
	kind: Kind;
	label?: string;
	content?: string;
	labelLanguage?: string;
	language?: string;
	programmingLanguage?: string;
	describes?: string;
	implementationOf?: string;
	attributedTo?: string;
	source?: string;
	sourceUrl?: string;
	date?: string;
	qid?: string;
	comment?: string;
}

interface NormalizedInput {
	content: string | undefined;
	language: string;
	labelLanguage: string;
	programmingLanguageItemId?: string;
	describes: string[];
	implementationOf: string[];
}

export const embeddableAddSpecialContent: Tool<typeof inputSchema> = {
	name: 'embeddable-add-special-content',
	description:
		"Creates or updates a quotation, mathematical expression or code-snippet item on a wiki with the EmbeddableContent extension, mirroring the Special:AddQuotation / AddMath / AddCodeSnippet forms, and returns the item ID and latest revision. Requires the edit right.\n\nThe item is classified instance of the kind's class and carries the content as the kind's payload property (content text for quotations, code source for snippets, LaTeX source for math), plus the provenance block you supply: attributedTo, source, sourceUrl and date. Math delimiters are stripped from content, and a quotation's content is stored as monolingual text in language. To find existing entities — including the attributedTo person or source item — use wikibase-search-entities first.\n\nSet qid to update an existing item instead: statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed. For the field table, property IDs and a ready-to-submit example, call embeddable-describe-entity-type first.",
	inputSchema,
	annotations: {
		title: 'Add special content',
		readOnlyHint: false,
		// Update mode replaces managed statements, so the tool can overwrite.
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'add special content',
	target: (a) => a.qid ?? a.label ?? a.kind,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const { vocabulary, classes, missing } = await resolveVocabulary(ctx);
		const kind = args.kind;
		const payloadKey = PAYLOAD_KEY[kind];

		const needed = [
			'instanceOf',
			`payloadProperties.${payloadKey}`,
			`classes.${payloadKey}`,
			'provenance.attributedTo',
			'provenance.sourceUrl',
			'provenance.source',
			'provenance.date',
		];
		if (kind === 'math') {
			needed.push('describes');
		}
		if (kind === 'code-snippet') {
			needed.push('programmingLanguage', 'implementationOf');
		}
		const absent = needed.filter((key) => missing.includes(key));
		if (absent.length > 0) {
			return ctx.format.error(
				'upstream_failure',
				`This wiki is missing EmbeddableContent vocabulary entries (${absent.join(', ')}) that embeddable-add-special-content needs. Check the extension's configuration.`,
			);
		}

		const creating = args.qid === undefined;
		const normalized = await validateInput(ctx, args, kind, creating);
		if (normalized instanceof Error) {
			return ctx.format.invalidInput(normalized.message);
		}

		const additions = buildClaims(args, vocabulary, normalized, kind);

		if (args.qid !== undefined) {
			return updateExisting(ctx, args.qid, args, additions, normalized.labelLanguage);
		}
		return createNew(
			ctx,
			args,
			vocabulary,
			classes,
			additions,
			normalized.labelLanguage,
			payloadKey,
		);
	},
};

async function validateInput(
	ctx: ToolContext,
	args: ItemWriteArgs,
	kind: Kind,
	creating: boolean,
): Promise<NormalizedInput | Error> {
	if (creating && args.label === undefined) {
		return new Error('label is required when creating an item.');
	}
	if (creating && args.content === undefined) {
		return new Error(`content is required when creating a ${kind} item.`);
	}

	const labelLanguage = args.labelLanguage ?? 'en';
	const language = kind === 'quotation' ? (args.language ?? labelLanguage) : labelLanguage;
	if (!LANGUAGE_CODE.test(language)) {
		return new Error(
			`"${language}" is not a valid MediaWiki language code. Pass a lowercase code such as en, fr or en-gb.`,
		);
	}
	if (!LANGUAGE_CODE.test(labelLanguage)) {
		return new Error(
			`"${labelLanguage}" is not a valid MediaWiki language code for labelLanguage. Pass a lowercase code such as en, fr or en-gb.`,
		);
	}

	let content: string | undefined;
	if (args.content !== undefined) {
		content = kind === 'math' ? stripMathDelimiters(args.content) : args.content.trim();
		if (content === '') {
			return new Error('content is empty after trimming/delimiter-stripping.');
		}
	}

	let programmingLanguageItemId: string | undefined;
	if (args.programmingLanguage !== undefined && kind === 'code-snippet') {
		const resolved = await resolveItemIdOrLabel(ctx, args.programmingLanguage);
		if (resolved === undefined) {
			return new Error(
				`programmingLanguage "${args.programmingLanguage}" is neither an item ID nor an English label of an existing item.`,
			);
		}
		programmingLanguageItemId = resolved;
	}

	const describes = kind === 'math' ? parseIdList(args.describes) : [];
	if (describes === null) {
		return new Error('describes must be comma/semicolon-separated item IDs.');
	}

	const implementationOf = kind === 'code-snippet' ? parseIdList(args.implementationOf) : [];
	if (implementationOf === null) {
		return new Error('implementationOf must be comma/semicolon-separated item IDs.');
	}

	if (args.sourceUrl !== undefined && !isHttpUrl(args.sourceUrl)) {
		return new Error(`sourceUrl "${args.sourceUrl}" is not an http(s) URL.`);
	}
	if (args.date !== undefined && parseDayDate(args.date) === null) {
		return new Error(`date "${args.date}" is not a calendar date in YYYY-MM-DD form.`);
	}

	return {
		content,
		language,
		labelLanguage,
		...(programmingLanguageItemId !== undefined ? { programmingLanguageItemId } : {}),
		describes,
		implementationOf,
	};
}

/** The new statements for the provided fields, shared by create and update. */
function buildClaims(
	args: ItemWriteArgs,
	vocabulary: EmbeddableVocabulary,
	normalized: NormalizedInput,
	kind: Kind,
): ReturnType<typeof entityStatement>[] {
	const payload = vocabulary.payloadProperties[PAYLOAD_KEY[kind]];
	const v = vocabulary;

	const claims: ReturnType<typeof entityStatement>[] = [];
	if (normalized.content !== undefined) {
		if (kind === 'quotation') {
			claims.push(monolingualStatement(payload, normalized.content, normalized.language));
		} else {
			claims.push(stringStatement(payload, normalized.content));
		}
	}
	if (kind === 'code-snippet' && normalized.programmingLanguageItemId !== undefined) {
		claims.push(entityStatement(v.programmingLanguage, normalized.programmingLanguageItemId));
	}
	for (const id of normalized.describes) {
		claims.push(entityStatement(v.describes, id));
	}
	for (const id of normalized.implementationOf) {
		claims.push(entityStatement(v.implementationOf, id));
	}
	if (args.attributedTo !== undefined) {
		claims.push(entityStatement(v.provenance.attributedTo, args.attributedTo));
	}
	if (args.source !== undefined) {
		claims.push(entityStatement(v.provenance.source, args.source));
	}
	if (args.sourceUrl !== undefined) {
		claims.push(stringStatement(v.provenance.sourceUrl, args.sourceUrl));
	}
	const date = parseDayDate(args.date);
	if (date !== null) {
		claims.push(dayStatement(v.provenance.date, date));
	}
	return claims;
}

async function createNew(
	ctx: ToolContext,
	args: ItemWriteArgs,
	vocabulary: EmbeddableVocabulary,
	classes: EmbeddableClasses,
	additions: ReturnType<typeof entityStatement>[],
	labelLanguage: string,
	classKey: keyof Pick<EmbeddableClasses, 'quotation' | 'code' | 'math'>,
): Promise<CallToolResult> {
	const instanceOf = entityStatement(vocabulary.instanceOf, classes[classKey]);
	const data = {
		labels: { [labelLanguage]: { language: labelLanguage, value: args.label } },
		claims: [instanceOf, ...additions],
	};
	const summary = editSummary(ctx, 'embeddable-add-special-content', args.comment);
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

async function updateExisting(
	ctx: ToolContext,
	qid: string,
	args: ItemWriteArgs,
	additions: ReturnType<typeof entityStatement>[],
	labelLanguage: string,
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
	if (args.label !== undefined) {
		data.labels = { [labelLanguage]: { language: labelLanguage, value: args.label } };
	}
	const summary = editSummary(ctx, 'embeddable-add-special-content', args.comment);
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

function parseIdList(input: string | undefined): string[] | null {
	return splitItemIds(input);
}

/** An item ID as-is, or the item whose English label equals the value. */
async function resolveItemIdOrLabel(ctx: ToolContext, value: string): Promise<string | undefined> {
	const trimmed = value.trim();
	if (ITEM_ID.test(trimmed)) {
		return trimmed.toUpperCase();
	}
	const mwn: Mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsearchentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbsearchentities',
		search: trimmed,
		language: 'en',
		type: 'item',
		limit: 10,
		format: 'json',
		formatversion: '2',
	})) as { search?: { id?: string; label?: string }[] };

	return response.search?.find((result) => result.label === trimmed)?.id;
}
