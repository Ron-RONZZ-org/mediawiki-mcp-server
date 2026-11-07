import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { contextOn } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { embeddableAuthoritySearch } from '../../../../src/tools/extensions/embeddable-content/embeddable-authority-search.ts';

function contextReturning(payload: unknown) {
	const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(payload) });
	return { mwn, ctx: contextOn(mwn) };
}

describe('embeddable-authority-search', () => {
	it('sends a DOI lookup with the API defaults and returns the shaped records', async () => {
		const { mwn, ctx } = contextReturning({
			authoritysearch: {
				records: [
					{
						kind: 'work',
						provider: 'crossref',
						record: { title: 'A Paper', authors: [{ label: 'Ada Lovelace' }] },
						suggestedAddFields: { title: 'A Paper', doi: '10.1/x' },
						local: { publisher: { qid: 'Q100' }, authors: [{ qid: 'Q300', exact: true }] },
					},
				],
				warnings: [],
			},
		});

		const result = await embeddableAuthoritySearch.handle(
			toolArgs(embeddableAuthoritySearch, {
				kind: 'work',
				doi: '10.1/x',
				resolveLocal: true,
			}),
			ctx,
		);

		const data = assertStructuredData(result);
		expect(data.records[0].suggestedAddFields.title).toBe('A Paper');
		expect(mwn.request).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'authority-search',
				kind: 'work',
				mode: 'search',
				doi: '10.1/x',
				resolveLocal: '1',
				fetchPage: '1',
				authorMode: 'text',
				limit: '10',
				language: 'en',
				formatversion: '2',
			}),
		);
	});

	it('sends a Wikidata harvest without the optional identifier keys', async () => {
		const { mwn, ctx } = contextReturning({
			authoritysearch: { records: [{ kind: 'work', record: { title: 'A Book' } }], warnings: [] },
		});

		await embeddableAuthoritySearch.handle(
			toolArgs(embeddableAuthoritySearch, {
				kind: 'work',
				mode: 'harvest',
				wikidataId: 'Q1',
			}),
			ctx,
		);

		expect(mwn.request).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'authority-search',
				kind: 'work',
				mode: 'harvest',
				wikidataId: 'Q1',
				resolveLocal: '0',
			}),
		);
		const request = mwn.request.mock.calls[0][0] as Record<string, string>;
		expect(request.query).toBeUndefined();
		expect(request.doi).toBeUndefined();
	});

	it('reports an upstream failure when the wiki predates the module', async () => {
		const { ctx } = contextReturning({ error: { code: 'unknown_action' } });

		const result = await embeddableAuthoritySearch.handle(
			toolArgs(embeddableAuthoritySearch, { kind: 'person', query: 'Ada Lovelace' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});
});
