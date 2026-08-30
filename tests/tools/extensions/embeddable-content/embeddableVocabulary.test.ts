import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import {
	resolveVocabulary,
	clearVocabularyCache,
} from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { vocabularyRequestResponse, VOCABULARY_ENTITIES } from './vocabFixture.ts';

function contextWith(request: (params: { action?: string; props?: string }) => Promise<unknown>) {
	const mock = createMockMwn({ request: vi.fn(request) });
	const ctx = fakeContext({ mwn: async () => mock as never });
	return { mock, ctx };
}

beforeEach(() => {
	clearVocabularyCache();
});

describe('embeddableVocabulary', () => {
	it('keeps the default IDs whose labels verify against the wiki', async () => {
		const { ctx } = contextWith(vi.fn().mockResolvedValue(vocabularyRequestResponse()));

		const { vocabulary, classes, missing } = await resolveVocabulary(ctx);

		expect(vocabulary.instanceOf).toBe('P1');
		expect(vocabulary.payloadProperties).toEqual({ quotation: 'P2', code: 'P3', math: 'P4' });
		expect(vocabulary.provenance).toEqual({
			attributedTo: 'P6',
			sourceUrl: 'P7',
			date: 'P8',
			source: 'P28',
		});
		expect(classes).toMatchObject({ book: 'Q9', scholarlyArticle: 'Q10', webpage: 'Q339' });
		expect(missing).toEqual([]);
	});

	it('re-resolves an ID whose label mismatches by exact-label search', async () => {
		const request = vi.fn((params: { action?: string }) =>
			params.action === 'wbsearchentities'
				? // The label search finds the real 'instance of' property.
					Promise.resolve({ search: [{ id: 'P999', label: 'instance of' }] })
				: // The vocabulary probe, with P1 mislabelled.
					Promise.resolve({
						entities: {
							...VOCABULARY_ENTITIES,
							P1: { id: 'P1', labels: { en: { value: 'is-a' } } },
						},
					}),
		);
		const { ctx } = contextWith(request);

		const { vocabulary } = await resolveVocabulary(ctx);

		expect(vocabulary.instanceOf).toBe('P999');
	});

	it('reports vocabulary entries neither probe could resolve', async () => {
		const request = vi.fn((params: { action?: string }) =>
			params.action === 'wbsearchentities'
				? Promise.resolve({ search: [] })
				: Promise.resolve({
						entities: { ...VOCABULARY_ENTITIES, P28: { id: 'P28', missing: '' } },
					}),
		);
		const { ctx } = contextWith(request);

		const { missing } = await resolveVocabulary(ctx);

		expect(missing).toContain('provenance.source');
	});

	it('caches the resolution per wiki key', async () => {
		const request = vi.fn().mockResolvedValue(vocabularyRequestResponse());
		const { ctx } = contextWith(request);

		await resolveVocabulary(ctx);
		await resolveVocabulary(ctx);

		// One resolution = the properties batch + the classes batch; the cache
		// means a second resolution makes no further requests.
		expect(request).toHaveBeenCalledTimes(2);
	});
});
