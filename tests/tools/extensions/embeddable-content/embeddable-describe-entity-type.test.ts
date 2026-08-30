import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData } from '../../../helpers/structuredResult.ts';
import { clearVocabularyCache } from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { embeddableDescribeEntityType } from '../../../../src/tools/extensions/embeddable-content/embeddable-describe-entity-type.ts';
import { vocabularyRequestResponse } from './vocabFixture.ts';

function contextWith() {
	const mock = createMockMwn({ request: vi.fn().mockResolvedValue(vocabularyRequestResponse()) });
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
		expect(book.classItem.id).toBe('Q9');
		expect(book.fields.map((f: { field: string }) => f.field)).toContain('authors');
		expect(
			data.citationSource.classes.find((c: { classKey: string }) => c.classKey === 'webpage')
				.parentClass,
		).toBe('website');
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
