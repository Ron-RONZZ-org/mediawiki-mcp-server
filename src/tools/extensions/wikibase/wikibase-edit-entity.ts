import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { formatEditComment } from '../../../wikis/utils.ts';
import { lostEditEntityCreateResult, lostEditEntityUpdateResult } from './wikibaseWriteOutcome.ts';

const inputSchema = {
	entityId: z
		.string()
		// `data` is entity JSON keyed on `claims`, which is how items, properties and
		// lexemes serialise their statements. Excluded are the entity types that key
		// them under something else: WikibaseMediaInfo uses `statements`, so the
		// payload this tool documents does not describe an M-id.
		.regex(/^[QqPpLl]\d+$/, 'Item, property or lexeme ID, such as Q42, P31 or L1')
		.optional()
		.describe(
			'The item, property or lexeme to write to. Omit to create a new item or property. Other entity types, such as MediaInfo M-ids, are not supported.',
		),
	entityType: z
		.enum(['item', 'property'])
		.default('item')
		.describe('Kind of entity to create. Ignored when entityId is set.'),
	data: z
		.record(z.string(), z.unknown())
		.describe(
			'The change, in Wikibase\'s entity JSON. Keys: labels, descriptions, aliases, claims, sitelinks. Terms are keyed by language code as {"en":{"language":"en","value":"Berlin"}}; claims is a list of statements.',
		),
	clear: z
		.boolean()
		.optional()
		.describe(
			'Removes everything the entity currently holds before applying data, instead of merging into it.',
		),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

interface EditEntityResponse {
	entity?: { id?: string; type?: string; lastrevid?: number };
}

export const wikibaseEditEntity: Tool<typeof inputSchema> = {
	name: 'wikibase-edit-entity',
	description:
		'Creates or changes a Wikibase entity from a JSON description of the change, and returns the entity ID and new revision ID. Enabled only when the wiki is a Wikibase repository. Omit entityId to create a new item or property, or name an item, property or lexeme to edit it. Requires the edit right.\n\ndata is merged into the entity: terms and statements it does not mention are left alone, and a term given for a language replaces that language\'s term. clear=true empties the entity first, so anything absent from data is deleted. When the wiki\'s response is lost and no entity comes back, the tool re-reads the wiki — the current terms of a term-only update, or a term-store search for a create — and reports whether the write landed before you retry.\n\nExample data, setting an English label and adding one statement:\n{"labels":{"en":{"language":"en","value":"Berlin"}},"claims":[{"mainsnak":{"snaktype":"value","property":"P31","datavalue":{"type":"wikibase-entityid","value":{"entity-type":"item","id":"Q515"}}},"type":"statement","rank":"normal"}]}\n\nCreating a property requires datatype in data, which is fixed once the property exists, and sitelinks apply to items only. A lexeme names its terms lemmas rather than labels, so its data uses that key. A statement\'s datavalue shape follows its property\'s datatype (read it with wikibase-get-entity on the property). For a single statement with an item, string, external-id or url value, wikibase-add-statement builds the JSON instead.',
	inputSchema,
	annotations: {
		title: 'Edit Wikibase entity',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'edit Wikibase entity',
	target: (a) => a.entityId ?? a.entityType,

	async handle(
		{ entityId, entityType, data, clear, comment },
		ctx: ToolContext,
	): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const summary = formatEditComment(ctx, 'wikibase-edit-entity', comment);
		const creating = entityId === undefined;
		const params: Record<string, string | number | boolean> = {
			action: 'wbeditentity',
			...(creating ? { new: entityType } : { id: entityId.toUpperCase() }),
			data: JSON.stringify(data),
			...(clear === true ? { clear: true } : {}),
			...(summary !== undefined ? { summary } : {}),
		};

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbeditentity response shape; trusted at this boundary
		const response = (await ctx.edit.submit(mwn, params)) as EditEntityResponse | undefined;
		const entity = response?.entity;
		if (entity?.id === undefined) {
			// Lost response: re-read the wiki and report whether the write
			// landed instead of guessing.
			if (creating) {
				return lostEditEntityCreateResult(ctx, {
					entityType,
					labels: termMapOf(data.labels),
				});
			}
			return lostEditEntityUpdateResult(ctx, {
				qid: entityId.toUpperCase(),
				clear: clear === true,
				labels: termMapOf(data.labels),
				descriptions: termMapOf(data.descriptions),
				hasClaims: isNonEmptyArray(data.claims),
				hasSitelinks: isNonEmptyObject(data.sitelinks),
			});
		}

		return ctx.format.ok({
			entityId: entity.id,
			entityType: entity.type,
			latestRevisionId: entity.lastrevid,
		});
	},
};

/** A term map as wbeditentity data carries it: { en: { language, value } }. */
function termMapOf(section: unknown): Record<string, { value: string }> | undefined {
	if (typeof section !== 'object' || section === null || Array.isArray(section)) {
		return undefined;
	}
	const map: Record<string, { value: string }> = {};
	for (const [language, term] of Object.entries(section)) {
		if (
			typeof term === 'object' &&
			term !== null &&
			!Array.isArray(term) &&
			'value' in term &&
			typeof term.value === 'string'
		) {
			map[language] = { value: term.value };
		}
	}
	return Object.keys(map).length > 0 ? map : undefined;
}

function isNonEmptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0;
}

function isNonEmptyObject(value: unknown): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length > 0
	);
}
