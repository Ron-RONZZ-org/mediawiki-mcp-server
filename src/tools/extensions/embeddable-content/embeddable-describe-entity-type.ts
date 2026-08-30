import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { resolveVocabulary } from './embeddableVocabulary.ts';

interface SourceFieldContract {
	classes: {
		classKey?: string;
		label?: string;
		classItemId?: string;
		parentClass?: string | null;
		fields?: string[];
		requiredOnCreate?: string[];
	}[];
	propertyIds: {
		instanceOf?: string;
		provenance?: Record<string, string>;
		citationMetadata?: Record<string, string>;
		sourceProperties?: Record<string, string>;
		externalIds?: Record<string, string>;
	};
}

interface SpecialContentFieldContract {
	flows: {
		kind?: string;
		class?: { id: string; label?: string };
		payloadProperty?: { id: string; datatype: string };
		fields?: string[];
		requiredOnCreate?: string[];
	}[];
	example: Record<string, string>;
	propertyIds: {
		instanceOf?: string;
		payloadProperties?: Record<string, string>;
		programmingLanguage?: string;
		describes?: string | null;
		implementationOf?: string | null;
		provenance?: Record<string, string>;
	};
}

/**
 * Fetches the special-content field contract from the wiki's own
 * action=addspecialcontent-fields endpoint. Returns undefined when the wiki
 * did not answer it (an EmbeddableContent version too old to serve it).
 */
async function fetchSpecialContentFields(
	ctx: ToolContext,
): Promise<SpecialContentFieldContract | undefined> {
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=addspecialcontent-fields response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'addspecialcontent-fields',
		formatversion: '2',
	})) as {
		contentfields?: {
			kinds?: {
				kind?: string;
				classItemId?: string;
				payloadPropertyId?: string;
				fields?: string[];
				requiredOnCreate?: string[];
			}[];
			propertyIds?: SpecialContentFieldContract['propertyIds'];
		};
	};
	const fields = response.contentfields;
	if (fields?.kinds === undefined || fields.propertyIds === undefined) {
		return undefined;
	}
	return {
		flows: fields.kinds.map((k) => ({
			kind: k.kind,
			...(k.classItemId !== undefined ? { class: { id: k.classItemId, label: k.kind } } : {}),
			...(k.payloadPropertyId !== undefined
				? {
						payloadProperty: {
							id: k.payloadPropertyId,
							datatype: k.kind === 'quotation' ? 'monolingualtext' : 'string',
						},
					}
				: {}),
			fields: k.fields ?? [],
			requiredOnCreate: k.requiredOnCreate ?? [],
		})),
		example: {
			kind: 'quotation',
			label: 'First words of the quote',
			content: 'The quotation text',
			language: 'en',
			attributedTo: 'Q94',
		},
		propertyIds: fields.propertyIds,
	};
}

/**
 * Fetches the citation-source field contract from the wiki's own
 * action=addsource-fields endpoint. Returns undefined when the wiki did not
 * answer it (an EmbeddableContent version too old to serve it).
 */
async function fetchCitationSource(ctx: ToolContext): Promise<SourceFieldContract | undefined> {
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=addsource-fields response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'addsource-fields',
		formatversion: '2',
	})) as { sourcefields?: SourceFieldContract };
	const fields = response.sourcefields;
	if (fields?.classes === undefined || fields.propertyIds === undefined) {
		return undefined;
	}
	return fields;
}

const inputSchema = {
	kind: z
		.enum(['special-content', 'citation-source', 'semantic-entity'])
		.optional()
		.describe(
			'Narrow the report to one family: the special-content Add* forms (quotation, math, code-snippet), the citation-source AddSource classes, or the semantic-entity Add* forms (person, software, collective, fictional-character, other). Omitted, all are returned.',
		),
} as const;

export const embeddableDescribeEntityType: Tool<typeof inputSchema> = {
	name: 'embeddable-describe-entity-type',
	description:
		'Returns the field tables, resolved property IDs and a ready-to-submit example for the EmbeddableContent Add* flows, as the discovery counterpart of embeddable-add-special-content, embeddable-add-citation-source and embeddable-add-semantic-entity. Enabled only when the wiki has the EmbeddableContent extension.\n\nCall this before the add tools to see exactly which fields a kind or class exposes, which properties they are stored on (resolved on this wiki), and a JSON example of a full submission.',
	inputSchema,
	annotations: {
		title: 'Describe entity type',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'describe entity type',
	target: (a) => a.kind ?? 'all',
	async handle({ kind }, ctx: ToolContext): Promise<CallToolResult> {
		const { vocabulary, missing } = await resolveVocabulary(ctx);

		// Both add-flow sections are served by the wiki's own fields
		// endpoints — the field contracts (SourceFieldMap, SpecialContentFieldMap)
		// have one publisher each, so discovery can never drift from the
		// add flows. The semantic-entity section is still local (Phase 3).
		const specialContent =
			kind === undefined || kind === 'special-content'
				? await fetchSpecialContentFields(ctx)
				: undefined;
		const citationSource =
			kind === undefined || kind === 'citation-source' ? await fetchCitationSource(ctx) : undefined;
		if (kind === 'citation-source' && citationSource === undefined) {
			return ctx.format.error(
				'upstream_failure',
				'The wiki did not answer action=addsource-fields — its EmbeddableContent version is too old to serve the source field contract.',
			);
		}
		if (kind === 'special-content' && specialContent === undefined) {
			return ctx.format.error(
				'upstream_failure',
				'The wiki did not answer action=addspecialcontent-fields — its EmbeddableContent version is too old to serve the special-content field contract.',
			);
		}
		const semanticEntity =
			kind === undefined || kind === 'semantic-entity'
				? {
						kinds: SEMANTIC_KIND_SCHEMA.map((entry) => ({
							kind: entry.kind,
							classItem: entry.classId,
							fields: [...entry.fields].map((field) => ({
								field,
								property: semanticFieldProperty(field, vocabulary),
							})),
							requiredOnCreate: entry.requiredOnCreate,
							example: entry.example,
						})),
					}
				: undefined;
		// The source-related property ids come from the wiki's config (via the
		// fields endpoint when it answered); the rest resolve locally.
		const sourcePropertyIds = citationSource?.propertyIds;
		const contentPropertyIds = specialContent?.propertyIds;

		return ctx.format.ok({
			propertyIds: {
				instanceOf: sourcePropertyIds?.instanceOf ?? vocabulary.instanceOf,
				payloadProperties: contentPropertyIds?.payloadProperties ?? vocabulary.payloadProperties,
				programmingLanguage:
					contentPropertyIds?.programmingLanguage ?? vocabulary.programmingLanguage,
				provenance: sourcePropertyIds?.provenance ?? vocabulary.provenance,
				describes: contentPropertyIds?.describes ?? vocabulary.describes,
				implementationOf: contentPropertyIds?.implementationOf ?? vocabulary.implementationOf,
				citationMetadata: sourcePropertyIds?.citationMetadata ?? vocabulary.citationMetadata,
				sourceProperties: sourcePropertyIds?.sourceProperties ?? vocabulary.sourceProperties,
				externalIds: sourcePropertyIds?.externalIds ?? vocabulary.externalIds,
				personProperties: vocabulary.personProperties,
				fossProperties: vocabulary.fossProperties,
				collectiveProperties: vocabulary.collectiveProperties,
				fictionalCharacter: vocabulary.fictionalCharacter,
			},
			...(specialContent !== undefined ? { specialContent } : {}),
			...(citationSource !== undefined ? { citationSource } : {}),
			...(semanticEntity !== undefined ? { semanticEntity } : {}),
			...(missing.length > 0
				? {
						unresolvedVocabulary: missing,
					}
				: {}),
		});
	},
};

/** The class item id and fields per semantic kind, for the discovery output. */
const SEMANTIC_KIND_SCHEMA: readonly {
	kind: string;
	classId: string;
	fields: readonly string[];
	requiredOnCreate: string;
	example: Record<string, string>;
}[] = [
	{
		kind: 'person',
		classId: 'person',
		fields: [
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
		],
		requiredOnCreate: 'givenName or familyName (the label is built from them)',
		example: {
			kind: 'person',
			givenName: 'Ada',
			familyName: 'Lovelace',
			orcid: '0000-0000-0000-0000',
		},
	},
	{
		kind: 'software',
		classId: 'software',
		fields: [
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
		],
		requiredOnCreate: 'label',
		example: { kind: 'software', label: 'Example FOSS Project', license: 'Q302' },
	},
	{
		kind: 'collective',
		classId: 'organization',
		fields: [
			'label',
			'description',
			'collectiveClass',
			'parentOrganization',
			'officialWebsite',
			'wikidataId',
		],
		requiredOnCreate: 'label',
		example: {
			kind: 'collective',
			label: 'Example Organization',
			collectiveClass: 'non-profit-organization',
		},
	},
	{
		kind: 'fictional-character',
		classId: 'fictionalCharacter',
		fields: ['givenName', 'familyName', 'description', 'presentInWork'],
		requiredOnCreate: 'givenName or familyName (the label is built from them)',
		example: {
			kind: 'fictional-character',
			givenName: 'Sherlock',
			familyName: 'Holmes',
			presentInWork: 'Q42',
		},
	},
	{
		kind: 'other',
		classId: 'instanceOf',
		fields: ['label', 'description', 'instanceOf', 'statements'],
		requiredOnCreate: 'label and instanceOf',
		example: { kind: 'other', label: 'Anything', instanceOf: 'Q163' },
	},
];

function semanticFieldProperty(
	field: string,
	vocabulary: {
		personProperties: Record<string, string>;
		fossProperties: Record<string, string>;
		collectiveProperties: Record<string, string>;
		fictionalCharacter: Record<string, string>;
		externalIds: Record<string, string>;
		programmingLanguage: string;
		instanceOf: string;
	},
): string {
	switch (field) {
		case 'instanceOf':
			return vocabulary.instanceOf;
		case 'programmingLanguage':
			return vocabulary.programmingLanguage;
		case 'officialWebsite':
			return vocabulary.personProperties.officialWebsite;
		case 'dateOfBirth':
			return vocabulary.personProperties.dateOfBirth;
		case 'placeOfBirth':
			return vocabulary.personProperties.placeOfBirth;
		case 'dateOfDeath':
			return vocabulary.personProperties.dateOfDeath;
		case 'placeOfDeath':
			return vocabulary.personProperties.placeOfDeath;
		case 'developer':
			return vocabulary.fossProperties.developer;
		case 'license':
			return vocabulary.fossProperties.license;
		case 'operatingSystem':
			return vocabulary.fossProperties.operatingSystem;
		case 'userInterface':
			return vocabulary.fossProperties.userInterface;
		case 'hasUse':
			return vocabulary.fossProperties.hasUse;
		case 'sourceCodeRepository':
			return vocabulary.fossProperties.sourceCodeRepository;
		case 'documentationUrl':
			return vocabulary.fossProperties.documentationUrl;
		case 'parentOrganization':
			return vocabulary.collectiveProperties.parentOrganization;
		case 'presentInWork':
			return vocabulary.fictionalCharacter.presentInWork;
		case 'orcid':
			return vocabulary.externalIds.orcid;
		case 'viafId':
			return vocabulary.externalIds.viafId;
		case 'isni':
			return vocabulary.externalIds.isni;
		case 'wikidataId':
			return vocabulary.externalIds.wikidataId;
		case 'openalexAuthorId':
			return vocabulary.externalIds.openalexAuthorId;
		case 'label':
		case 'description':
		case 'givenName':
		case 'familyName':
		case 'collectiveClass':
		case 'statements':
			return 'not a statement (term / class picker / raw claims)';
	}
	// Every semantic field is handled above; the union is exhaustive.
	return 'not a statement (term / class picker / raw claims)';
}
