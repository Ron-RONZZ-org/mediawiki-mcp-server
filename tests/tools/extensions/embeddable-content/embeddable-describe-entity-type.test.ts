import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData } from '../../../helpers/structuredResult.ts';
import { clearVocabularyCache } from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { embeddableDescribeEntityType } from '../../../../src/tools/extensions/embeddable-content/embeddable-describe-entity-type.ts';
import { vocabularyRequestResponse } from './vocabFixture.ts';

function contextWith() {
	const mock = createMockMwn({
		request: vi.fn((params: { action?: string }) => {
			if (params.action === 'addsource-fields') {
				return Promise.resolve({
					sourcefields: {
						classes: [
							{
								classKey: 'book',
								label: 'book',
								classItemId: 'Q9',
								parentClass: null,
								fields: [
									'title',
									'description',
									'authors',
									'publisher',
									'pages',
									'year',
									'isbn',
									'accessUrl',
									'wikidataId',
								],
								requiredOnCreate: ['title', 'authors'],
							},
							{
								classKey: 'webpage',
								label: 'web page',
								classItemId: 'Q339',
								parentClass: 'website',
								fields: ['title', 'description', 'authors', 'url', 'year', 'parent', 'wikidataId'],
								requiredOnCreate: ['title', 'authors', 'parent'],
							},
						],
						propertyIds: {
							instanceOf: 'P1',
							provenance: { attributedTo: 'P6', sourceUrl: 'P7', date: 'P8', source: 'P28' },
							citationMetadata: { publisher: 'P54', journal: 'P57' },
							sourceProperties: { partOf: 'P44', url: 'P48', duration: 'P45' },
							externalIds: { isbn13: 'P17', doi: 'P16', wikidataId: 'P12' },
						},
					},
				});
			}
			if (params.action === 'addspecialcontent-fields') {
				return Promise.resolve({
					contentfields: {
						kinds: [
							{
								kind: 'quotation',
								classItemId: 'Q2',
								payloadPropertyId: 'P2',
								fields: [
									'label',
									'content',
									'labelLanguage',
									'language',
									'attributedTo',
									'source',
									'sourceUrl',
									'date',
								],
								requiredOnCreate: ['label', 'content', 'attributedTo'],
							},
							{
								kind: 'math',
								classItemId: 'Q4',
								payloadPropertyId: 'P4',
								fields: [
									'label',
									'content',
									'labelLanguage',
									'describes',
									'attributedTo',
									'source',
									'sourceUrl',
									'date',
								],
								requiredOnCreate: ['label', 'content'],
							},
							{
								kind: 'code-snippet',
								classItemId: 'Q3',
								payloadPropertyId: 'P3',
								fields: [
									'label',
									'content',
									'labelLanguage',
									'programmingLanguage',
									'implementationOf',
									'attributedTo',
									'source',
									'sourceUrl',
									'date',
								],
								requiredOnCreate: ['label', 'content'],
							},
						],
						propertyIds: {
							instanceOf: 'P1',
							payloadProperties: { quotation: 'P2', code: 'P3', math: 'P4' },
							programmingLanguage: 'P5',
							describes: 'P29',
							implementationOf: 'P30',
							provenance: { attributedTo: 'P6', sourceUrl: 'P7', date: 'P8', source: 'P28' },
						},
					},
				});
			}
			return Promise.resolve(vocabularyRequestResponse());
		}),
	});
	return fakeContext({ mwn: async () => mock as never });
}

beforeEach(() => {
	clearVocabularyCache();
});

describe('embeddable-describe-entity-type', () => {
	it('reports the resolved property IDs and both flow families', async () => {
		const ctx = contextWith();

		const result = await embeddableDescribeEntityType.handle(
			toolArgs(embeddableDescribeEntityType, {}),
			ctx,
		);

		const data = assertStructuredData(result);
		expect(data.propertyIds.instanceOf).toBe('P1');
		expect(data.propertyIds.provenance).toEqual({
			attributedTo: 'P6',
			sourceUrl: 'P7',
			date: 'P8',
			source: 'P28',
		});
		expect(data.specialContent.flows.map((f: { kind: string }) => f.kind)).toEqual([
			'quotation',
			'math',
			'code-snippet',
		]);
		expect(data.specialContent.flows[0].payloadProperty).toEqual({
			id: 'P2',
			datatype: 'monolingualtext',
		});
		const book = data.citationSource.classes.find(
			(c: { classKey: string }) => c.classKey === 'book',
		);
		expect(book.classItemId).toBe('Q9');
		expect(book.fields).toContain('authors');
		expect(
			data.citationSource.classes.find((c: { classKey: string }) => c.classKey === 'webpage')
				.parentClass,
		).toBe('website');
		expect(
			data.citationSource.classes.find((c: { classKey: string }) => c.classKey === 'webpage')
				.requiredOnCreate,
		).toContain('parent');
		// The source contract comes from the wiki's own endpoint.
		expect(data.propertyIds.citationMetadata).toEqual({ publisher: 'P54', journal: 'P57' });
	});

	it('reports the semantic-entity kinds and their fields', async () => {
		const ctx = contextWith();

		const result = await embeddableDescribeEntityType.handle(
			toolArgs(embeddableDescribeEntityType, { kind: 'semantic-entity' }),
			ctx,
		);

		const data = assertStructuredData(result);
		const kinds = data.semanticEntity.kinds.map((k: { kind: string }) => k.kind);
		expect(kinds).toEqual(['person', 'software', 'collective', 'fictional-character', 'other']);
		const person = data.semanticEntity.kinds.find((k: { kind: string }) => k.kind === 'person');
		expect(person.fields.map((f: { field: string }) => f.field)).toContain('orcid');
		expect(person.fields.find((f: { field: string }) => f.field === 'orcid').property).toBe('P13');
		expect(data.propertyIds.personProperties.dateOfBirth).toBe('P50');
		expect(data.propertyIds.fossProperties.developer).toBe('P33');
		expect(data.citationSource).toBeUndefined();
		expect(data.specialContent).toBeUndefined();
	});

	it('narrows to one family with kind', async () => {
		const ctx = contextWith();

		const result = await embeddableDescribeEntityType.handle(
			toolArgs(embeddableDescribeEntityType, { kind: 'special-content' }),
			ctx,
		);

		const data = assertStructuredData(result);
		expect(data.specialContent).toBeDefined();
		expect(data.citationSource).toBeUndefined();
	});

	it('is annotated as read-only', () => {
		expect(embeddableDescribeEntityType.annotations.readOnlyHint).toBe(true);
	});
});
