import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { clearVocabularyCache } from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { embeddableAddCitationSource } from '../../../../src/tools/extensions/embeddable-content/embeddable-add-citation-source.ts';
import { vocabularyRequestResponse } from './vocabFixture.ts';

const CREATED = { entity: { id: 'Q777', type: 'item', lastrevid: 12 }, success: 1 };

const baseEdit = fakeContext().edit;

function contextWith(submit = vi.fn().mockResolvedValue(CREATED), readEntityResponse?: unknown) {
	const mock = createMockMwn({
		request: vi.fn((params: { action?: string; props?: string }) => {
			if (params.action === 'wbgetentities' && params.props?.includes('claims')) {
				return Promise.resolve(
					readEntityResponse ?? {
						entities: {
							Q42: { id: 'Q42', type: 'item', labels: { en: { value: 'A book' } }, claims: {} },
						},
					},
				);
			}
			return Promise.resolve(vocabularyRequestResponse());
		}),
	});
	const ctx = fakeContext({
		mwn: async () => mock as never,
		edit: { ...baseEdit, submit },
	});
	return { mock, ctx, submit };
}

beforeEach(() => {
	clearVocabularyCache();
});

describe('embeddable-add-citation-source', () => {
	it('creates a book with authors, publisher, year, pages and ISBN', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6, Q94',
				publisher: 'Q42',
				pages: '1-300',
				year: '1937',
				isbn: '9780547928227',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).toMatchObject({ action: 'wbeditentity', new: 'item' });
		const data = JSON.parse(params.data);
		expect(data.labels).toEqual({ en: { language: 'en', value: 'The Hobbit' } });
		const byProperty = Object.fromEntries(
			data.claims.map((c: { mainsnak: { property: string } }) => [c.mainsnak.property, c]),
		);
		expect(byProperty.P1.mainsnak.datavalue.value.id).toBe('Q9');
		// Two authors → two attributed to statements.
		const authors = data.claims.filter(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P6',
		);
		expect(
			authors.map(
				(a: { mainsnak: { datavalue: { value: { id: string } } } }) =>
					a.mainsnak.datavalue.value.id,
			),
		).toEqual(['Q6', 'Q94']);
		expect(byProperty.P54.mainsnak.datavalue.value.id).toBe('Q42');
		expect(byProperty.P8.mainsnak.datavalue.value.time).toBe('+1937-00-00T00:00:00Z');
		expect(byProperty.P8.mainsnak.datavalue.value.precision).toBe(9);
		expect(byProperty.P24.mainsnak.datavalue.value).toBe('1-300');
		expect(byProperty.P17.mainsnak.datavalue.value).toBe('9780547928227');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', created: true });
	});

	it('stores a duration as whole seconds', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'song',
				title: 'A Song',
				authors: 'Q6',
				duration: '3:45',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		const duration = data.claims.find(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P45',
		);
		expect(duration.mainsnak.datavalue.value).toEqual({ amount: '+225', unit: '1' });
	});

	it('rejects a field the class does not expose, naming the class fields', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
				journal: 'Q42',
			}),
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('journal');
		expect(envelope.message).toContain('book');
		expect(submit).not.toHaveBeenCalled();
	});

	it('requires at least one author except for book-excerpt', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'film',
				title: 'A Film',
				year: '2001',
			}),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('requires a parent item of the right class for a child class', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'webpage',
				title: 'A Page',
				url: 'https://example.org/page',
				authors: 'Q6',
				parent: 'Q42',
			}),
			ctx,
		);

		// The default parent fixture has no instance-of claims, so it is not a website.
		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('copies year and authors from the parent book for a book-excerpt', async () => {
		const parent = {
			entities: {
				Q42: {
					id: 'Q42',
					type: 'item',
					labels: { en: { value: 'The Hobbit' } },
					claims: {
						P1: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P1',
									datavalue: {
										type: 'wikibase-entityid',
										value: { 'entity-type': 'item', id: 'Q9' },
									},
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q42$c1',
							},
						],
						P8: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P8',
									datavalue: {
										type: 'time',
										value: { time: '+1937-00-00T00:00:00Z', precision: 9 },
									},
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q42$c2',
							},
						],
						P6: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P6',
									datavalue: {
										type: 'wikibase-entityid',
										value: { 'entity-type': 'item', id: 'Q6' },
									},
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q42$c3',
							},
						],
					},
				},
			},
		};
		const { ctx, submit } = contextWith(vi.fn().mockResolvedValue(CREATED), parent);

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book-excerpt',
				title: 'Chapter 5',
				pages: '100-120',
				volume: '2',
				parent: 'Q42',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		const byProperty = Object.fromEntries(
			data.claims.map((c: { mainsnak: { property: string } }) => [c.mainsnak.property, c]),
		);
		expect(byProperty.P1.mainsnak.datavalue.value.id).toBe('Q340');
		// Year and author copied from the parent book.
		expect(byProperty.P8.mainsnak.datavalue.value.time).toBe('+1937-00-00T00:00:00Z');
		expect(byProperty.P6.mainsnak.datavalue.value.id).toBe('Q6');
		// part of statement to the parent.
		expect(byProperty.P44.mainsnak.datavalue.value.id).toBe('Q42');
		// Auto-generated description from pages/volume + parent label.
		expect(data.descriptions).toEqual({
			en: { language: 'en', value: 'Pages 100-120 Volume 2 of The Hobbit' },
		});
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777' });
	});

	it('updates an existing source, replacing only the provided statements', async () => {
		const existing = {
			entities: {
				Q777: {
					id: 'Q777',
					type: 'item',
					claims: {
						P1: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P1',
									datavalue: {
										type: 'wikibase-entityid',
										value: { 'entity-type': 'item', id: 'Q9' },
									},
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c1',
							},
						],
						P24: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P24',
									datavalue: { type: 'string', value: '1-300' },
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c2',
							},
						],
						P17: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P17',
									datavalue: { type: 'string', value: 'old-isbn' },
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c3',
							},
						],
					},
				},
			},
		};
		const submit = vi
			.fn()
			.mockResolvedValue({ entity: { id: 'Q777', type: 'item', lastrevid: 13 }, success: 1 });
		const { ctx } = contextWith(submit, existing);

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				qid: 'Q777',
				isbn: '9780547928227',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).toMatchObject({ action: 'wbeditentity', id: 'Q777' });
		const data = JSON.parse(params.data);
		const properties = data.claims.map(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property,
		);
		expect(properties.filter((p: string) => p === 'P1')).toHaveLength(1);
		// Old ISBN replaced, pages kept.
		expect(data.claims.find((c: { id?: string }) => c.id === 'Q777$c3')).toBeUndefined();
		expect(data.claims.find((c: { id?: string }) => c.id === 'Q777$c2')).toBeDefined();
		const newIsbn = data.claims.find(
			(c: { mainsnak: { property: string }; id?: string }) =>
				c.mainsnak.property === 'P17' && c.id === undefined,
		);
		expect(newIsbn.mainsnak.datavalue.value).toBe('9780547928227');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', updated: true });
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(embeddableAddCitationSource.annotations.readOnlyHint).toBe(false);
	});
});
