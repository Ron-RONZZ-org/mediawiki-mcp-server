import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/transport/httpFetch.ts', async () => {
	const actual = await vi.importActual<typeof import('../../../../src/transport/httpFetch.ts')>(
		'../../../../src/transport/httpFetch.ts',
	);
	return { ...actual, postForm: vi.fn() };
});

import { postForm } from '../../../../src/transport/httpFetch.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { wikibaseSearchEntities } from '../../../../src/tools/extensions/wikibase/wikibase-search-entities.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';

const ENDPOINT = 'https://query.example.org/sparql';

function contextWithEndpoint() {
	return fakeContext({
		siteInfoCache: {
			get: () => ({
				server: 'https://test.wiki',
				articlepath: '/wiki',
				sparqlEndpoint: ENDPOINT,
			}),
			set: () => {},
			delete: () => {},
		} as never,
	});
}

function contextWithoutEndpoint() {
	return fakeContext({
		siteInfoCache: {
			get: () => ({ server: 'https://test.wiki', articlepath: '/wiki' }),
			set: () => {},
			delete: () => {},
		} as never,
	});
}

function bindings(rows: { id: string; label?: string; description?: string }[]): string {
	return JSON.stringify({
		head: { vars: ['id', 'label', 'description'] },
		results: {
			bindings: rows.map((row) =>
				Object.fromEntries(
					Object.entries(row).map(([column, value]) => [column, { type: 'literal', value }]),
				),
			),
		},
	});
}

describe('wikibase-search-entities contains mode', () => {
	beforeEach(() => {
		vi.mocked(postForm).mockReset();
	});

	it('queries the wiki query service for case-insensitive substring matches', async () => {
		vi.mocked(postForm).mockResolvedValue(
			bindings([
				{ id: 'Q164', label: 'MediaWiki', description: 'wiki engine' },
				{
					id: 'Q1385',
					label: 'MediaWiki (chapter in The Architecture of Open Source Applications)',
				},
			]),
		);
		const ctx = contextWithEndpoint();

		const result = await wikibaseSearchEntities.handle(
			toolArgs(wikibaseSearchEntities, { query: 'edia', mode: 'contains' }),
			ctx,
		);

		expect(vi.mocked(postForm).mock.calls[0][0]).toBe(ENDPOINT);
		const sparql = vi.mocked(postForm).mock.calls[0][1].query as string;
		expect(sparql).toContain('CONTAINS(LCASE(?label), LCASE("edia"))');
		expect(sparql).toContain('FILTER NOT EXISTS { ?item wikibase:propertyType ?propType }');
		expect(sparql).toContain('skos:altLabel');
		const data = assertStructuredData(result);
		expect(data.results).toEqual([
			'Q164 — MediaWiki — wiki engine',
			'Q1385 — MediaWiki (chapter in The Architecture of Open Source Applications)',
		]);
	});

	it('includes properties only for entityType=property', async () => {
		vi.mocked(postForm).mockResolvedValue(bindings([{ id: 'P6', label: 'attributed to' }]));
		const ctx = contextWithEndpoint();

		await wikibaseSearchEntities.handle(
			toolArgs(wikibaseSearchEntities, {
				query: 'attributed',
				mode: 'contains',
				entityType: 'property',
			}),
			ctx,
		);

		const sparql = vi.mocked(postForm).mock.calls[0][1].query as string;
		expect(sparql).toContain('?item wikibase:propertyType ?propType .');
		expect(sparql).not.toContain('FILTER NOT EXISTS { ?item wikibase:propertyType');
	});

	it('escapes quotes and backslashes in the query literal', async () => {
		vi.mocked(postForm).mockResolvedValue(bindings([]));
		const ctx = contextWithEndpoint();

		await wikibaseSearchEntities.handle(
			toolArgs(wikibaseSearchEntities, { query: 'a"b\\c', mode: 'contains' }),
			ctx,
		);

		const sparql = vi.mocked(postForm).mock.calls[0][1].query as string;
		expect(sparql).toContain('LCASE("a\\"b\\\\c")');
	});

	it('refuses without querying when the wiki advertises no query service', async () => {
		const ctx = contextWithoutEndpoint();

		const result = await wikibaseSearchEntities.handle(
			toolArgs(wikibaseSearchEntities, { query: 'edia', mode: 'contains' }),
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('advertises no query service');
		expect(vi.mocked(postForm)).not.toHaveBeenCalled();
	});

	it('surfaces a malformed query service answer as upstream_failure', async () => {
		vi.mocked(postForm).mockResolvedValue('not json at all');
		const ctx = contextWithEndpoint();

		const result = await wikibaseSearchEntities.handle(
			toolArgs(wikibaseSearchEntities, { query: 'edia', mode: 'contains' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});

	it('defaults to prefix mode, so an omitted mode never touches the query service', async () => {
		const mockRequest = vi.fn().mockResolvedValue({ search: [] });
		const ctx = fakeContext({
			mwn: async () => ({ request: mockRequest }) as never,
			siteInfoCache: {
				get: () => ({ server: 'https://test.wiki', articlepath: '/wiki' }),
				set: () => {},
				delete: () => {},
			} as never,
		});

		await wikibaseSearchEntities.handle(toolArgs(wikibaseSearchEntities, { query: 'edia' }), ctx);

		expect(vi.mocked(postForm)).not.toHaveBeenCalled();
		expect(mockRequest).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'wbsearchentities' }),
		);
	});
});
