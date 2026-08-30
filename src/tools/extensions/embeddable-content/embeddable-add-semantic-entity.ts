import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import type { EmbeddableClasses, EmbeddableVocabulary } from './embeddableVocabulary.ts';
import { resolveVocabulary } from './embeddableVocabulary.ts';
import {
	DAY_DATE,
	ITEM_ID,
	dayStatement,
	editSummary,
	entityStatement,
	mergeClaims,
	parseDayDate,
	readEntity,
	resolveItemIdOrLabel,
	splitItemIds,
	stringStatement,
	submitEntityWrite,
	isHttpUrl,
} from './embeddableWrite.ts';

const KINDS = ['person', 'software', 'collective', 'fictional-character', 'other'] as const;
type Kind = (typeof KINDS)[number];

const SEMANTIC_FIELDS = [
	'label',
	'description',
	'givenName',
	'familyName',
	'dateOfBirth',
	'placeOfBirth',
	'dateOfDeath',
	'placeOfDeath',
	'orcid',
	'viafId',
	'isni',
	'wikidataId',
	'openalexAuthorId',
	'officialWebsite',
	'developer',
	'license',
	'programmingLanguage',
	'operatingSystem',
	'userInterface',
	'hasUse',
	'sourceCodeRepository',
	'documentationUrl',
	'collectiveClass',
	'parentOrganization',
	'presentInWork',
	'instanceOf',
	'statements',
] as const;
type SemanticField = (typeof SEMANTIC_FIELDS)[number];

/** The fields each kind's Add* form exposes. */
const KIND_FIELDS: Record<Kind, ReadonlySet<SemanticField>> = {
	person: new Set([
		'givenName',
		'familyName',
		'description',
		'dateOfBirth',
		'placeOfBirth',
		'dateOfDeath',
		'placeOfDeath',
		'orcid',
		'viafId',
		'isni',
		'wikidataId',
		'openalexAuthorId',
		'officialWebsite',
	]),
	software: new Set([
		'label',
		'description',
		'developer',
		'license',
		'programmingLanguage',
		'operatingSystem',
		'userInterface',
		'hasUse',
		'officialWebsite',
		'sourceCodeRepository',
		'documentationUrl',
		'wikidataId',
	]),
	collective: new Set([
		'label',
		'description',
		'collectiveClass',
		'parentOrganization',
		'officialWebsite',
		'wikidataId',
	]),
	'fictional-character': new Set(['givenName', 'familyName', 'description', 'presentInWork']),
	other: new Set(['label', 'description', 'instanceOf', 'statements']),
};

/** Vocabulary path behind each field; terms (label/description) have none. */
const FIELD_PATH: Partial<Record<SemanticField, string>> = {
	dateOfBirth: 'personProperties.dateOfBirth',
	placeOfBirth: 'personProperties.placeOfBirth',
	dateOfDeath: 'personProperties.dateOfDeath',
	placeOfDeath: 'personProperties.placeOfDeath',
	// The official-website property is shared across the person/FOSS/collective
	// vocabularies; the person entry verifies the same ID the others resolve.
	officialWebsite: 'personProperties.officialWebsite',
	developer: 'fossProperties.developer',
	license: 'fossProperties.license',
	programmingLanguage: 'programmingLanguage',
	operatingSystem: 'fossProperties.operatingSystem',
	userInterface: 'fossProperties.userInterface',
	hasUse: 'fossProperties.hasUse',
	sourceCodeRepository: 'fossProperties.sourceCodeRepository',
	documentationUrl: 'fossProperties.documentationUrl',
	parentOrganization: 'collectiveProperties.parentOrganization',
	presentInWork: 'fictionalCharacter.presentInWork',
	orcid: 'externalIds.orcid',
	viafId: 'externalIds.viafId',
	isni: 'externalIds.isni',
	wikidataId: 'externalIds.wikidataId',
	openalexAuthorId: 'externalIds.openalexAuthorId',
	instanceOf: 'instanceOf',
};

/** The AddCollective class picker's preset keys → vocabulary class keys. */
const COLLECTIVE_CLASS_PRESETS: Record<string, keyof EmbeddableClasses> = {
	organization: 'organization',
	'group-of-humans': 'groupOfHumans',
	'private-company': 'privateCompany',
	'public-company': 'publicCompany',
	'non-profit-organization': 'nonProfitOrganization',
	'governmental-agency': 'governmentalAgency',
	'music-band': 'musicBand',
	'educational-institution': 'educationalInstitution',
	'research-institute': 'researchInstitute',
	'political-party': 'politicalParty',
	'trade-union': 'tradeUnion',
	'religious-organization': 'religiousOrganization',
	'sports-team': 'sportsTeam',
};

const inputSchema = {
	kind: z
		.enum(KINDS)
		.describe(
			'The kind of semantic entity: person, software (a free/open-source software item), collective (an organization or group), fictional-character, or other (any class — the catch-all that takes instanceOf and raw statements).',
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
	statements: z
		.array(z.record(z.string(), z.unknown()))
		.optional()
		.describe(
			"For kind=other only: raw Wikibase statement objects (each with a mainsnak carrying property and datavalue), merged with the instanceOf statement. For deeper control over an entity's full JSON, use wikibase-edit-entity instead.",
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

interface SemanticArgs {
	kind: Kind;
	label?: string;
	description?: string;
	givenName?: string;
	familyName?: string;
	dateOfBirth?: string;
	placeOfBirth?: string;
	dateOfDeath?: string;
	placeOfDeath?: string;
	orcid?: string;
	viafId?: string;
	isni?: string;
	wikidataId?: string;
	openalexAuthorId?: string;
	officialWebsite?: string;
	developer?: string;
	license?: string;
	programmingLanguage?: string;
	operatingSystem?: string;
	userInterface?: string;
	hasUse?: string;
	sourceCodeRepository?: string;
	documentationUrl?: string;
	collectiveClass?: string;
	parentOrganization?: string;
	presentInWork?: string;
	instanceOf?: string;
	statements?: Record<string, unknown>[];
	qid?: string;
	comment?: string;
}

interface NormalizedSemantic {
	label?: string;
	description?: string;
	instanceOf?: string;
	programmingLanguageItemId?: string;
}

export const embeddableAddSemanticEntity: Tool<typeof inputSchema> = {
	name: 'embeddable-add-semantic-entity',
	description:
		'Creates or updates a person, software (FOSS), collective, fictional-character or other-class item on a wiki with the EmbeddableContent extension, mirroring the Special:AddPerson / AddSoftware / AddCollective / AddFictionalCharacter forms, and returns the item ID and latest revision. Requires the edit right.\n\nEach kind carries its form\'s fields as statements: person — given/family name as the label, birth/death dates and places, ORCID/VIAF/ISNI/Wikidata/OpenAlex author IDs, official website; software — label, developer/license/operating-system/user-interface/has-use item IDs, programming language, website/repository/documentation URLs; collective — label, the collectiveClass (default organization), parent organization, official website; fictional-character — given/family name as the label "{given} {family} (fictional character)" and present-in-work items. kind=other is the catch-all: give instanceOf and raw statements for any class the typed kinds do not cover.\n\nResolve entity IDs with wikibase-search-entities first; a programming language accepts a label and is resolved. Portraits and logos (image uploads) are not written by this tool. Set qid to update an existing item instead: statements on the fields you provide are replaced, blank fields keep the existing statements, and the class is never changed. For the field tables, property IDs and examples, call embeddable-describe-entity-type first.',
	inputSchema,
	annotations: {
		title: 'Add semantic entity',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'add semantic entity',
	target: (a) => a.qid ?? a.label ?? a.kind,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const { vocabulary, classes, missing } = await resolveVocabulary(ctx);
		const kind = args.kind;

		const provided = providedFields(args);
		const disallowed = [...provided].filter((field) => !KIND_FIELDS[kind].has(field));
		if (disallowed.length > 0) {
			return ctx.format.invalidInput(
				`kind ${kind} does not expose the field(s) ${disallowed.join(', ')}. Its fields are ${[
					...KIND_FIELDS[kind],
				].join(', ')}.`,
			);
		}

		const needed = ['instanceOf'];
		const classId = classIdFor(args);
		if (classId !== undefined && classId.kind === 'map') {
			needed.push(`classes.${classId.classKey}`);
		}
		for (const field of provided) {
			const path = FIELD_PATH[field];
			if (path !== undefined) {
				needed.push(path);
			}
		}
		const absent = needed.filter((key) => missing.includes(key));
		if (absent.length > 0) {
			return ctx.format.error(
				'upstream_failure',
				`This wiki is missing EmbeddableContent vocabulary entries (${absent.join(', ')}) that embeddable-add-semantic-entity needs. Check the extension's configuration.`,
			);
		}

		const creating = args.qid === undefined;
		const normalized = await validateSemantic(ctx, args, kind, creating);
		if (normalized instanceof Error) {
			return ctx.format.invalidInput(normalized.message);
		}

		const additions = buildSemanticClaims(args, vocabulary, normalized);

		if (args.qid !== undefined) {
			return updateExisting(ctx, args.qid, args, kind, additions, normalized);
		}
		return createNew(ctx, args, vocabulary, classes, kind, classId, additions, normalized);
	},
};

function providedFields(args: SemanticArgs): Set<SemanticField> {
	return new Set(
		SEMANTIC_FIELDS.filter((field) => args[field] !== undefined && args[field] !== ''),
	);
}

/** The class item the kind classifies under; other has none (instanceOf rules). */
function classIdFor(
	args: SemanticArgs,
): { kind: 'map'; classKey: keyof EmbeddableClasses } | { kind: 'id'; id: string } | undefined {
	switch (args.kind) {
		case 'person':
			return { kind: 'map', classKey: 'person' };
		case 'software':
			return { kind: 'map', classKey: 'software' };
		case 'collective': {
			const preset = collectiveClassPreset(args.collectiveClass);
			if (preset !== undefined) {
				return { kind: 'map', classKey: preset };
			}
			return args.collectiveClass !== undefined && ITEM_ID.test(args.collectiveClass)
				? { kind: 'id', id: args.collectiveClass.toUpperCase() }
				: { kind: 'map', classKey: 'organization' };
		}
		case 'fictional-character':
			return { kind: 'map', classKey: 'fictionalCharacter' };
		case 'other':
			return undefined;
	}
	// The union is exhaustive; kept for the linter's benefit.
	return undefined;
}

/** The vocabulary class key of a collective preset, or undefined for a direct ID. */
function collectiveClassPreset(value: string | undefined): keyof EmbeddableClasses | undefined {
	if (value === undefined) {
		return undefined;
	}
	return COLLECTIVE_CLASS_PRESETS[value];
}

/** True when collectiveClass is a preset key or an item ID. */
function collectiveClassValid(value: string | undefined): boolean {
	if (value === undefined) {
		return true;
	}
	return COLLECTIVE_CLASS_PRESETS[value] !== undefined || ITEM_ID.test(value);
}

async function validateSemantic(
	ctx: ToolContext,
	args: SemanticArgs,
	kind: Kind,
	creating: boolean,
): Promise<NormalizedSemantic | Error> {
	let label: string | undefined;
	if (kind === 'person' || kind === 'fictional-character') {
		const names = [args.givenName, args.familyName].filter(
			(n): n is string => n !== undefined && n !== '',
		);
		if (creating && names.length === 0) {
			return new Error(
				`At least one of givenName or familyName is required when creating a ${kind} item.`,
			);
		}
		if (names.length > 0) {
			const base = names.join(' ');
			label = kind === 'fictional-character' ? `${base} (fictional character)` : base;
		}
	} else if (kind === 'other') {
		if (creating && args.instanceOf === undefined) {
			return new Error('instanceOf is required when creating an other item.');
		}
		if (creating && args.label === undefined) {
			return new Error('label is required when creating an item.');
		}
		label = args.label;
	} else {
		if (creating && args.label === undefined) {
			return new Error(`label is required when creating a ${kind} item.`);
		}
		label = args.label;
	}

	let description = args.description;
	if (kind === 'fictional-character' && (description === undefined || description === '')) {
		description = await fictionalDescription(ctx, args.presentInWork);
	}

	for (const urlField of ['officialWebsite', 'sourceCodeRepository', 'documentationUrl'] as const) {
		const value = args[urlField];
		if (value !== undefined && !isHttpUrl(value)) {
			return new Error(`${urlField} "${value}" is not an http(s) URL.`);
		}
	}

	for (const field of ['dateOfBirth', 'dateOfDeath'] as const) {
		const value = args[field];
		if (value !== undefined && parseDayDate(value) === null) {
			return new Error(`${field} "${value}" is not a calendar date in YYYY-MM-DD form.`);
		}
	}

	if (!collectiveClassValid(args.collectiveClass)) {
		return new Error(
			`collectiveClass "${args.collectiveClass}" is not one of the AddCollective presets nor an item ID.`,
		);
	}

	let programmingLanguageItemId: string | undefined;
	if (args.programmingLanguage !== undefined) {
		const resolved = await resolveItemIdOrLabel(ctx, args.programmingLanguage);
		if (resolved === undefined) {
			return new Error(
				`programmingLanguage "${args.programmingLanguage}" is neither an item ID nor an English label of an existing item.`,
			);
		}
		programmingLanguageItemId = resolved;
	}

	return {
		...(label !== undefined ? { label } : {}),
		...(description !== undefined && description !== '' ? { description } : {}),
		...(kind === 'other' && args.instanceOf !== undefined ? { instanceOf: args.instanceOf } : {}),
		...(programmingLanguageItemId !== undefined ? { programmingLanguageItemId } : {}),
	};
}

/** "fictional character in {labels…}" from the present-in-work items, best-effort. */
async function fictionalDescription(
	ctx: ToolContext,
	presentInWork: string | undefined,
): Promise<string | undefined> {
	const ids = splitItemIds(presentInWork);
	if (ids === null || ids.length === 0) {
		return undefined;
	}
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbgetentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbgetentities',
		ids: ids.join('|'),
		props: 'labels',
		languages: 'en',
		format: 'json',
		formatversion: '2',
	})) as { entities?: Record<string, { labels?: Record<string, { value?: string } | undefined> }> };

	const labels = ids
		.map((id) => response.entities?.[id]?.labels?.en?.value)
		.filter((v): v is string => v !== undefined);
	return labels.length > 0 ? `fictional character in ${labels.join(', ')}` : undefined;
}

function buildSemanticClaims(
	args: SemanticArgs,
	vocabulary: EmbeddableVocabulary,
	normalized: NormalizedSemantic,
): ReturnType<typeof entityStatement>[] {
	const v = vocabulary;
	const claims: ReturnType<typeof entityStatement>[] = [];

	switch (args.kind) {
		case 'person':
			for (const [field, property] of [
				['orcid', v.externalIds.orcid],
				['viafId', v.externalIds.viafId],
				['isni', v.externalIds.isni],
				['wikidataId', v.externalIds.wikidataId],
				['openalexAuthorId', v.externalIds.openalexAuthorId],
				['officialWebsite', v.personProperties.officialWebsite],
			] as const) {
				pushString(claims, args[field], property);
			}
			for (const [field, property] of [
				['dateOfBirth', v.personProperties.dateOfBirth],
				['dateOfDeath', v.personProperties.dateOfDeath],
			] as const) {
				const date = parseDayDate(args[field]);
				if (date !== null) {
					claims.push(dayStatement(property, date));
				}
			}
			for (const [field, property] of [
				['placeOfBirth', v.personProperties.placeOfBirth],
				['placeOfDeath', v.personProperties.placeOfDeath],
			] as const) {
				if (args[field] !== undefined) {
					claims.push(entityStatement(property, args[field]));
				}
			}
			break;

		case 'software':
			for (const [field, property] of [
				['officialWebsite', v.fossProperties.officialWebsite],
				['sourceCodeRepository', v.fossProperties.sourceCodeRepository],
				['documentationUrl', v.fossProperties.documentationUrl],
				['wikidataId', v.externalIds.wikidataId],
			] as const) {
				pushString(claims, args[field], property);
			}
			for (const [field, property] of [
				['developer', v.fossProperties.developer],
				['license', v.fossProperties.license],
				['operatingSystem', v.fossProperties.operatingSystem],
				['userInterface', v.fossProperties.userInterface],
				['hasUse', v.fossProperties.hasUse],
			] as const) {
				pushEntities(claims, args[field], property);
			}
			if (normalized.programmingLanguageItemId !== undefined) {
				claims.push(entityStatement(v.programmingLanguage, normalized.programmingLanguageItemId));
			}
			break;

		case 'collective':
			pushString(claims, args.officialWebsite, v.collectiveProperties.officialWebsite);
			pushString(claims, args.wikidataId, v.externalIds.wikidataId);
			if (args.parentOrganization !== undefined) {
				claims.push(
					entityStatement(v.collectiveProperties.parentOrganization, args.parentOrganization),
				);
			}
			break;

		case 'fictional-character':
			pushEntities(claims, args.presentInWork, v.fictionalCharacter.presentInWork);
			break;

		case 'other':
			if (args.statements !== undefined) {
				for (const statement of args.statements) {
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw Wikibase statement JSON; the wiki validates it, this boundary only passes it through
					claims.push(statement as unknown as ReturnType<typeof entityStatement>);
				}
			}
			break;
	}

	return claims;
}

function pushString(
	claims: ReturnType<typeof entityStatement>[],
	value: string | undefined,
	property: string,
): void {
	if (value !== undefined && value !== '') {
		claims.push(stringStatement(property, value));
	}
}

function pushEntities(
	claims: ReturnType<typeof entityStatement>[],
	value: string | undefined,
	property: string,
): void {
	const ids = splitItemIds(value);
	if (ids === null || ids.length === 0) {
		return;
	}
	for (const id of ids) {
		claims.push(entityStatement(property, id));
	}
}

/** The class item id for the create; the validated invariants guarantee one. */
function resolveInstanceOfId(
	kind: Kind,
	classId:
		| { kind: 'map'; classKey: keyof EmbeddableClasses }
		| { kind: 'id'; id: string }
		| undefined,
	classes: EmbeddableClasses,
	otherInstanceOf: string | undefined,
): string {
	if (kind === 'other') {
		if (otherInstanceOf === undefined) {
			throw new Error('internal: instanceOf missing for kind=other');
		}
		return otherInstanceOf;
	}
	if (classId === undefined) {
		throw new Error(`internal: class missing for kind ${kind}`);
	}
	return classId.kind === 'id' ? classId.id : classes[classId.classKey];
}

async function createNew(
	ctx: ToolContext,
	args: SemanticArgs,
	vocabulary: EmbeddableVocabulary,
	classes: EmbeddableClasses,
	kind: Kind,
	classId:
		| { kind: 'map'; classKey: keyof EmbeddableClasses }
		| { kind: 'id'; id: string }
		| undefined,
	additions: ReturnType<typeof entityStatement>[],
	normalized: NormalizedSemantic,
): Promise<CallToolResult> {
	if (normalized.label === undefined) {
		return ctx.format.error(
			'upstream_failure',
			'No label could be derived for this item; this is an internal validation gap.',
		);
	}
	const instanceOf = entityStatement(
		vocabulary.instanceOf,
		resolveInstanceOfId(kind, classId, classes, normalized.instanceOf),
	);

	const data: Record<string, unknown> = {
		labels: { en: { language: 'en', value: normalized.label } },
		claims: [instanceOf, ...additions],
	};
	if (normalized.description !== undefined) {
		data.descriptions = { en: { language: 'en', value: normalized.description } };
	}

	const summary = editSummary(ctx, 'embeddable-add-semantic-entity', args.comment);
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
	args: SemanticArgs,
	kind: Kind,
	additions: ReturnType<typeof entityStatement>[],
	normalized: NormalizedSemantic,
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
	if (normalized.label !== undefined) {
		data.labels = { en: { language: 'en', value: normalized.label } };
	}
	if (normalized.description !== undefined) {
		data.descriptions = { en: { language: 'en', value: normalized.description } };
	}
	const summary = editSummary(ctx, 'embeddable-add-semantic-entity', args.comment);
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
