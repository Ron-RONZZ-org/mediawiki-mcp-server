import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { ITEM_ID, DAY_DATE, resolveItemIdOrLabel } from './embeddableWrite.ts';

const KINDS = ['person', 'software', 'collective', 'fictional-character', 'other'] as const;

const inputSchema = {
	kind: z
		.enum(KINDS)
		.describe(
			'The kind of semantic entity: person, software (a free/open-source software item), collective (an organization or group), fictional-character, or other (any class — the catch-all that takes instanceOf).',
		),
	label: z
		.string()
		.min(1)
		.max(250)
		.optional()
		.describe(
			'The item label. Required for software, collective and other when creating; for person and fictional-character the label is built from givenName/familyName instead. On update it replaces the label.',
		),
	description: z
		.string()
		.max(2000)
		.optional()
		.describe("A short description; becomes the item's English description."),
	givenName: z
		.string()
		.optional()
		.describe('The given (first) name (person, fictional-character).'),
	familyName: z
		.string()
		.optional()
		.describe('The family (last) name (person, fictional-character).'),
	dateOfBirth: z
		.string()
		.regex(DAY_DATE, 'A calendar date in YYYY-MM-DD form')
		.optional()
		.describe('Date of birth at day precision (person).'),
	placeOfBirth: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe('Place of birth as an item ID (person).'),
	dateOfDeath: z
		.string()
		.regex(DAY_DATE, 'A calendar date in YYYY-MM-DD form')
		.optional()
		.describe('Date of death at day precision (person).'),
	placeOfDeath: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe('Place of death as an item ID (person).'),
	orcid: z.string().optional().describe('ORCID iD (person).'),
	viafId: z.string().optional().describe('VIAF ID (person).'),
	isni: z.string().optional().describe('ISNI (person).'),
	wikidataId: z
		.string()
		.optional()
		.describe('The corresponding Wikidata entity ID, e.g. Q5, stored as a Wikidata ID statement.'),
	openalexAuthorId: z.string().optional().describe('OpenAlex author ID, stored bare (person).'),
	officialWebsite: z
		.string()
		.optional()
		.describe('The official website as an http(s) URL (person, software, collective).'),
	developer: z
		.string()
		.optional()
		.describe('Comma/semicolon-separated item IDs of the developers (software).'),
	license: z
		.string()
		.optional()
		.describe('Comma/semicolon-separated item IDs of the licenses (software).'),
	programmingLanguage: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Programming language (software), as an item ID (Q57) or an English label resolved against the wiki\'s items (e.g. "Python").',
		),
	operatingSystem: z
		.string()
		.optional()
		.describe('Comma/semicolon-separated item IDs of the operating systems (software).'),
	userInterface: z
		.string()
		.optional()
		.describe('Comma/semicolon-separated item IDs of the user interfaces (software).'),
	hasUse: z
		.string()
		.optional()
		.describe('Comma/semicolon-separated item IDs of the uses (software).'),
	sourceCodeRepository: z
		.string()
		.optional()
		.describe('The source code repository as an http(s) URL (software).'),
	documentationUrl: z
		.string()
		.optional()
		.describe('The documentation as an http(s) URL (software).'),
	collectiveClass: z
		.string()
		.min(1)
		.optional()
		.describe(
			"The collective's class (collective): one of the AddCollective picker presets (organization, group-of-humans, private-company, public-company, non-profit-organization, governmental-agency, music-band, educational-institution, research-institute, political-party, trade-union, religious-organization, sports-team) or any item ID. Defaults to organization.",
		),
	parentOrganization: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe('The parent organization as an item ID (collective).'),
	presentInWork: z
		.string()
		.optional()
		.describe(
			'Comma/semicolon-separated item IDs of the works the character appears in (fictional-character). The description auto-generates from their labels when left blank.',
		),
	instanceOf: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q163')
		.optional()
		.describe(
			'The class item for kind=other, e.g. Q163 for a software item. Required when creating with other.',
		),
	qid: z
		.string()
		.regex(ITEM_ID, 'An item ID, such as Q42')
		.optional()
		.describe(
			'Set to update an existing item instead of creating one. Statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed.',
		),
	comment: z.string().optional().describe('Edit summary, appended to the generated one.'),
} as const;

export const embeddableAddSemanticEntity: Tool<typeof inputSchema> = {
	name: 'embeddable-add-semantic-entity',
	description:
		'Creates or updates a person, software (FOSS), collective, fictional-character or other-class item on a wiki with the EmbeddableContent extension, mirroring the Special:AddPerson / AddSoftware / AddCollective / AddFictionalCharacter forms, and returns the item ID and latest revision. Requires the edit right.\n\nThe item is created by the wiki\'s own semantic-entity service (action=addsemanticentity): each kind carries its form\'s fields as statements — person given/family name as the label plus birth/death dates and places, ORCID/VIAF/ISNI/Wikidata/OpenAlex author IDs and official website; software label plus developer/license/operating-system/user-interface/has-use item IDs, programming language, website/repository/documentation URLs; collective label plus the collectiveClass (default organization), parent organization and official website; fictional-character given/family name as the label "{given} {family} (fictional character)" with present-in-work items and an auto-generated description; kind=other is the catch-all with instanceOf. The classic Person:/Collective:/FOSS: page + sitelink are created like the forms. Portraits and logos (image uploads) are not written by this tool, and kind=other takes no raw statements — use wikibase-edit-entity for raw statement JSON.\n\nResolve entity IDs with wikibase-search-entities first; a programming language accepts a label and is resolved. Set qid to update an existing item instead: statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed. For the field tables, property IDs and examples, call embeddable-describe-entity-type first.',
	inputSchema,
	annotations: {
		title: 'Add semantic entity',
		readOnlyHint: false,
		// Update mode replaces managed statements, so the tool can overwrite.
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'add semantic entity',
	target: (a) => a.qid ?? a.label ?? a.kind,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();

		// programmingLanguage accepts an item ID or an English label; resolve
		// a label to its Q-id here (the wiki module is entity-mode only).
		let programmingLanguage = args.programmingLanguage;
		if (args.programmingLanguage !== undefined && !/^[Qq]\d+$/.test(args.programmingLanguage)) {
			const resolved = await resolveItemIdOrLabel(ctx, args.programmingLanguage);
			if (resolved === undefined) {
				return ctx.format.invalidInput(
					`programmingLanguage "${args.programmingLanguage}" is neither an item ID nor an English label of an existing item.`,
				);
			}
			programmingLanguage = resolved;
		}

		const params: Record<string, string> = {
			action: 'addsemanticentity',
			kind: args.kind,
		};
		for (const [field, value] of Object.entries({
			label: args.label,
			description: args.description,
			givenName: args.givenName,
			familyName: args.familyName,
			dateOfBirth: args.dateOfBirth,
			placeOfBirth: args.placeOfBirth,
			dateOfDeath: args.dateOfDeath,
			placeOfDeath: args.placeOfDeath,
			orcid: args.orcid,
			viafId: args.viafId,
			isni: args.isni,
			wikidataId: args.wikidataId,
			openalexAuthorId: args.openalexAuthorId,
			officialWebsite: args.officialWebsite,
			developer: args.developer,
			license: args.license,
			programmingLanguage,
			operatingSystem: args.operatingSystem,
			userInterface: args.userInterface,
			hasUse: args.hasUse,
			sourceCodeRepository: args.sourceCodeRepository,
			documentationUrl: args.documentationUrl,
			collectiveClass: args.collectiveClass,
			parentOrganization: args.parentOrganization,
			presentInWork: args.presentInWork,
			instanceOf: args.instanceOf,
		})) {
			if (value !== undefined && value !== '') {
				params[field] = value;
			}
		}
		if (args.qid !== undefined) {
			params.qid = args.qid.toUpperCase();
		}
		if (args.comment !== undefined && args.comment !== '') {
			params.summary = args.comment;
		}

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=addsemanticentity response shape; trusted at this boundary
		const response = (await ctx.edit.submit(mwn, params)) as {
			semantic?: {
				entityId?: string;
				entityType?: string;
				latestRevisionId?: number;
				created?: boolean;
				updated?: boolean;
				pageTitle?: string;
			};
		};

		const semantic = response?.semantic;
		if (semantic?.entityId === undefined) {
			return ctx.format.error(
				'upstream_failure',
				'The wiki accepted the request but returned no semantic result.',
			);
		}
		return ctx.format.ok({
			entityId: semantic.entityId,
			entityType: semantic.entityType,
			latestRevisionId: semantic.latestRevisionId,
			...(semantic.created === true ? { created: true } : {}),
			...(semantic.updated === true ? { updated: true } : {}),
			...(typeof semantic.pageTitle === 'string' ? { pageTitle: semantic.pageTitle } : {}),
		});
	},
};
