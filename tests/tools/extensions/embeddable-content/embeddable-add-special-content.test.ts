import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { clearVocabularyCache } from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { embeddableAddSpecialContent } from '../../../../src/tools/extensions/embeddable-content/embeddable-add-special-content.ts';
import { vocabularyRequestResponse } from './vocabFixture.ts';

const CREATED = { entity: { id: 'Q777', type: 'item', lastrevid: 12 }, success: 1 };

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

function contextWith(submit = vi.fn().mockResolvedValue(CREATED)) {
	const mock = createMockMwn({
		request: vi.fn().mockResolvedValue(vocabularyRequestResponse()),
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

describe('embeddable-add-special-content', () => {
	it('creates a quotation classified under its class with monolingual payload and provenance', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'quotation',
				label: 'Ada was first',
				content: 'Ada was first.',
				attributedTo: 'Q94',
				source: 'Q96',
				sourceUrl: 'https://example.org/page',
				date: '1843-12-01',
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ action: 'wbeditentity', new: 'item' });
		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(data.labels).toEqual({ en: { language: 'en', value: 'Ada was first' } });
		expect(data.claims).toHaveLength(6);
		const byProperty = Object.fromEntries(
			data.claims.map((c: { mainsnak: { property: string } }) => [c.mainsnak.property, c]),
		);
		expect(byProperty.P1.mainsnak.datavalue).toEqual({
			type: 'wikibase-entityid',
			value: { 'entity-type': 'item', id: 'Q2' },
		});
		expect(byProperty.P2.mainsnak.datavalue).toEqual({
			type: 'monolingualtext',
			value: { text: 'Ada was first.', language: 'en' },
		});
		expect(byProperty.P6.mainsnak.datavalue.value.id).toBe('Q94');
		expect(byProperty.P7.mainsnak.datavalue.value).toBe('https://example.org/page');
		expect(byProperty.P8.mainsnak.datavalue.value.time).toBe('+1843-12-01T00:00:00Z');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', created: true });
	});

	it('strips math delimiters before storing the payload', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'math',
				label: 'E = mc²',
				content: '$$E = mc^2$$',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(
			data.claims.find((c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P4')
				.mainsnak.datavalue.value,
		).toBe('E = mc^2');
	});

	it('resolves a code-snippet programming language label to its item', async () => {
		const { submit } = contextWith();

		const mock = createMockMwn({
			request: vi.fn((params: { action?: string }) =>
				params.action === 'wbsearchentities'
					? Promise.resolve({ search: [{ id: 'Q57', label: 'Python' }] })
					: Promise.resolve(vocabularyRequestResponse()),
			),
		});
		const ctxWithSearch = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submit },
		});

		await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'code-snippet',
				label: 'Hello world',
				content: 'print("hi")',
				programmingLanguage: 'Python',
			}),
			ctxWithSearch,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(
			data.claims.find((c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P5')
				.mainsnak.datavalue.value.id,
		).toBe('Q57');
	});

	it('accepts a Q-id programming language without a search', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'code-snippet',
				label: 'Hello world',
				content: 'print("hi")',
				programmingLanguage: 'Q57',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(
			data.claims.find((c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P5')
				.mainsnak.datavalue.value.id,
		).toBe('Q57');
	});

	it('errors when required fields are missing', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, { kind: 'quotation', content: 'text' }),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('errors on an invalid date', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'math',
				label: 'x',
				content: 'x^2',
				date: '1843-13-40',
			}),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('escapes multi-line content for storage instead of rejecting it', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'code-snippet',
				label: 'Multi-line',
				content: 'def f():\n    return 1',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		const payload = data.claims.find(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P3',
		);
		// Newlines stored as the literal \n sequence; backslashes escaped too.
		expect(payload.mainsnak.datavalue.value).toBe('def f():\\n    return 1');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', created: true });
	});

	it('escapes backslashes before newlines so literal sequences survive', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'code-snippet',
				label: 'Escapes',
				content: 'print("a\\nb")\nnext()',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		const payload = data.claims.find(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P3',
		);
		// The literal \n in the code becomes \\n (escaped backslash), the real
		// newline becomes \n — distinct stored forms.
		expect(payload.mainsnak.datavalue.value).toBe('print("a\\\\nb")\\nnext()');
	});

	it('updates an existing item by merging, keeping statements it does not manage', async () => {
		const mock = createMockMwn({
			request: vi.fn((params: { props?: string }) =>
				params.props?.includes('claims')
					? Promise.resolve({
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
														value: { 'entity-type': 'item', id: 'Q2' },
													},
												},
												type: 'statement',
												rank: 'normal',
												id: 'Q777$keep1',
											},
										],
										P2: [
											{
												mainsnak: {
													snaktype: 'value',
													property: 'P2',
													datavalue: {
														type: 'monolingualtext',
														value: { text: 'old', language: 'en' },
													},
												},
												type: 'statement',
												rank: 'normal',
												id: 'Q777$old-payload',
											},
										],
										P6: [
											{
												mainsnak: {
													snaktype: 'value',
													property: 'P6',
													datavalue: {
														type: 'wikibase-entityid',
														value: { 'entity-type': 'item', id: 'Q94' },
													},
												},
												type: 'statement',
												rank: 'normal',
												id: 'Q777$keep2',
											},
										],
									},
								},
							},
						})
					: Promise.resolve(vocabularyRequestResponse()),
			),
		});
		const submit = vi
			.fn()
			.mockResolvedValue({ entity: { id: 'Q777', type: 'item', lastrevid: 13 }, success: 1 });
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'quotation',
				qid: 'Q777',
				content: 'new text',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).toMatchObject({ action: 'wbeditentity', id: 'Q777' });
		const data = JSON.parse(params.data);
		const properties = data.claims.map(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property,
		);
		// The class and the kept attributedTo statement survive; the old payload is replaced.
		expect(properties.filter((p: string) => p === 'P1')).toHaveLength(1);
		expect(properties.filter((p: string) => p === 'P6')).toHaveLength(1);
		expect(properties.filter((p: string) => p === 'P2')).toHaveLength(1);
		const newPayload = data.claims.find(
			(c: { mainsnak: { property: string }; id?: string }) =>
				c.mainsnak.property === 'P2' && c.id === undefined,
		);
		expect(newPayload.mainsnak.datavalue.value.text).toBe('new text');
		// The kept statements carry their GUIDs.
		expect(data.claims.find((c: { id?: string }) => c.id === 'Q777$keep1')).toBeDefined();
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', updated: true });
	});

	it('reports a missing update target as not_found', async () => {
		const mock = createMockMwn({
			request: vi.fn((params: { props?: string }) =>
				params.props?.includes('claims')
					? Promise.resolve({ entities: { Q999: { id: 'Q999', missing: '' } } })
					: Promise.resolve(vocabularyRequestResponse()),
			),
		});
		const submit = vi.fn();
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await embeddableAddSpecialContent.handle(
			toolArgs(embeddableAddSpecialContent, {
				kind: 'math',
				qid: 'Q999',
				content: 'x',
			}),
			ctx,
		);

		assertStructuredError(result, 'not_found');
		expect(submit).not.toHaveBeenCalled();
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(embeddableAddSpecialContent.annotations.readOnlyHint).toBe(false);
	});
});
