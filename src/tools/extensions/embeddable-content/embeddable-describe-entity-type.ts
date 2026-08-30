import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';
import { resolveVocabulary } from './embeddableVocabulary.ts';
import {
	CLASS_FIELDS,
	CLASS_KEY_TO_VOCAB,
	CLASS_LABELS,
	FIELD_LABELS,
	PARENT_CLASS,
	PAYLOAD_KEY,
	SOURCE_CLASS_KEYS,
	SOURCE_FIELDS,
	SPECIAL_CONTENT_KINDS,
} from './embeddableSchema.ts';

const inputSchema = {
	kind: z
		.enum(['special-content', 'citation-source'])
		.optional()
		.describe(
			'Narrow the report to one family: the special-content Add* forms (quotation, math, code-snippet) or the citation-source AddSource classes. Omitted, both are returned.',
		),
} as const;

export const embeddableDescribeEntityType: Tool<typeof inputSchema> = {
	name: 'embeddable-describe-entity-type',
	description:
		'Returns the field tables, resolved property IDs and a ready-to-submit example for the EmbeddableContent Add* flows, as the discovery counterpart of embeddable-add-special-content and embeddable-add-citation-source. Enabled only when the wiki has the EmbeddableContent extension.\n\nCall this before the add tools to see exactly which fields a kind or class exposes, which properties they are stored on (resolved on this wiki), and a JSON example of a full submission.',
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
		const { vocabulary, classes, missing } = await resolveVocabulary(ctx);

		const specialContent =
			kind === undefined || kind === 'special-content'
				? {
						flows: SPECIAL_CONTENT_KINDS.map((k) => ({
							kind: k,
							class: {
								id: classes[PAYLOAD_KEY[k]],
								label: PAYLOAD_KEY[k],
							},
							payloadProperty: {
								id: vocabulary.payloadProperties[PAYLOAD_KEY[k]],
								datatype: k === 'quotation' ? 'monolingualtext' : 'string',
							},
							fields: specialContentFields(k),
						})),
						example: {
							kind: 'quotation',
							label: 'First words of the quote',
							content: 'The quotation text',
							language: 'en',
							attributedTo: 'Q94',
						},
					}
				: undefined;

		const citationSource =
			kind === undefined || kind === 'citation-source'
				? {
						classes: SOURCE_CLASS_KEYS.map((key) => ({
							classKey: key,
							label: CLASS_LABELS[key],
							classItem: {
								id: classes[CLASS_KEY_TO_VOCAB[key]],
								label: CLASS_LABELS[key],
							},
							parentClass: PARENT_CLASS[key],
							fields: [...CLASS_FIELDS[key]].map((field) => ({
								field,
								role: FIELD_LABELS[field],
								property: fieldPathLabel(field, vocabulary),
							})),
						})),
						fields: SOURCE_FIELDS.map((field) => ({
							field,
							role: FIELD_LABELS[field],
						})),
						example: {
							classKey: 'book',
							title: 'The Hobbit',
							authors: 'Q6',
							publisher: 'Q42',
							year: '1937',
							isbn: '9780547928227',
						},
					}
				: undefined;

		return ctx.format.ok({
			propertyIds: {
				instanceOf: vocabulary.instanceOf,
				payloadProperties: vocabulary.payloadProperties,
				programmingLanguage: vocabulary.programmingLanguage,
				provenance: vocabulary.provenance,
				describes: vocabulary.describes,
				implementationOf: vocabulary.implementationOf,
				citationMetadata: vocabulary.citationMetadata,
				sourceProperties: vocabulary.sourceProperties,
				externalIds: vocabulary.externalIds,
			},
			...(specialContent !== undefined ? { specialContent } : {}),
			...(citationSource !== undefined ? { citationSource } : {}),
			...(missing.length > 0
				? {
						unresolvedVocabulary: missing,
					}
				: {}),
		});
	},
};

function specialContentFields(kind: (typeof SPECIAL_CONTENT_KINDS)[number]): string[] {
	const fields = ['label', 'content'];
	if (kind === 'quotation') {
		fields.push('language (quotation only)');
	}
	if (kind === 'code-snippet') {
		fields.push('programmingLanguage (code-snippet only)');
	}
	if (kind === 'math') {
		fields.push('describes (math only)');
	}
	if (kind === 'code-snippet') {
		fields.push('implementationOf (code-snippet only)');
	}
	fields.push('attributedTo', 'source', 'sourceUrl', 'date');
	return fields;
}

function fieldPathLabel(
	field: (typeof SOURCE_FIELDS)[number],
	vocabulary: {
		provenance: { attributedTo: string; date: string };
		citationMetadata: Record<string, string>;
		sourceProperties: Record<string, string>;
		externalIds: Record<string, string>;
	},
): string {
	switch (field) {
		case 'authors':
			return vocabulary.provenance.attributedTo;
		case 'year':
			return vocabulary.provenance.date;
		case 'parent':
			return vocabulary.sourceProperties.partOf;
		case 'publisher':
			return vocabulary.citationMetadata.publisher;
		case 'journal':
			return vocabulary.citationMetadata.journal;
		case 'volume':
			return vocabulary.citationMetadata.volume;
		case 'issue':
			return vocabulary.citationMetadata.issue;
		case 'pages':
			return vocabulary.citationMetadata.pages;
		case 'chapters':
			return vocabulary.sourceProperties.chapters;
		case 'url':
			return vocabulary.sourceProperties.url;
		case 'duration':
			return vocabulary.sourceProperties.duration;
		case 'youtubeChannelId':
			return vocabulary.sourceProperties.youtubeChannelId;
		case 'youtubeVideoId':
			return vocabulary.sourceProperties.youtubeVideoId;
		case 'accessUrl':
			return vocabulary.sourceProperties.accessUrl;
		case 'isbn':
			return vocabulary.externalIds.isbn13;
		case 'doi':
			return vocabulary.externalIds.doi;
		case 'wikidataId':
			return vocabulary.externalIds.wikidataId;
		case 'openalexWorkId':
			return vocabulary.externalIds.openalexWorkId;
		case 'pubmedId':
			return vocabulary.externalIds.pubmedId;
		case 'title':
		case 'description':
			return 'term (label / description), not a statement';
	}
	// Every source field is handled above; the union is exhaustive.
	return 'term (label / description), not a statement';
}
