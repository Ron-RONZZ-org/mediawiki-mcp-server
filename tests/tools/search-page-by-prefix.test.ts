import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext } from '../helpers/fakeContext.ts';
import { searchPageByPrefix } from '../../src/tools/search-page-by-prefix.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

describe('search-page-by-prefix', () => {
	it('calls action=query&list=allpages with apprefix and aplimit', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: { allpages: [{ pageid: 1, ns: 0, title: 'Foo' }] },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		await searchPageByPrefix.handle({ prefix: 'F', limit: 50, namespace: 0 }, ctx);

		const call = mock.request.mock.calls[0][0];
		expect(call).toMatchObject({
			action: 'query',
			list: 'allpages',
			apprefix: 'F',
			aplimit: 50,
			apnamespace: 0,
		});
	});

	it('returns matching titles as structured results', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: {
					allpages: [
						{ pageid: 1, ns: 0, title: 'Alpha' },
						{ pageid: 2, ns: 0, title: 'Alphabet' },
					],
				},
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await searchPageByPrefix.handle({ prefix: 'Alph' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('- Title: Alpha');
		expect(text).toContain('  Page ID: 1');
		expect(text).toContain('- Title: Alphabet');
		expect(text).toContain('  Page ID: 2');
		expect(text).not.toContain('Truncation:');
	});

	it('returns an empty results array when no matches', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: { allpages: [] },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await searchPageByPrefix.handle({ prefix: 'Zzz' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Results: (none)');
		expect(text).not.toContain('Truncation:');
	});

	it('attaches a capped-no-continuation truncation when response.continue is present', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: { allpages: [{ pageid: 1, ns: 0, title: 'A' }] },
				continue: { apcontinue: 'B', continue: '-||' },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await searchPageByPrefix.handle({ prefix: 'A', limit: 10 }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Truncation:');
		expect(text).toContain('  Reason: capped-no-continuation');
		expect(text).toContain('  Returned count: 1');
		expect(text).toContain('  Limit: 10');
		expect(text).toContain('  Item noun: titles');
	});

	it('omits truncation when response.continue is absent', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: { allpages: [{ pageid: 1, ns: 0, title: 'A' }] },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await searchPageByPrefix.handle({ prefix: 'A' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).not.toContain('Truncation:');
	});

	it('surfaces errors as isError results via dispatcher', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockRejectedValue(new Error('API error')),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await dispatch(searchPageByPrefix, ctx)({ prefix: 'A' });

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('API error');
	});

	it('translates a namespace-style prefix into apnamespace plus the remainder', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: {
					allpages: [
						{ pageid: 508, ns: 2006, title: 'RonzzIT:Main' },
						{ pageid: 509, ns: 2006, title: 'RonzzIT:Runbook/Nextcloud' },
					],
				},
			}),
		});
		const ctx = prefixContext(mock, { ronzzit: 2006 });

		await searchPageByPrefix.handle({ prefix: 'RonzzIT:Main' }, ctx);

		const call = mock.request.mock.calls[0][0];
		expect(call).toMatchObject({
			action: 'query',
			list: 'allpages',
			apprefix: 'Main',
			apnamespace: 2006,
		});
	});

	it('lists a whole namespace for a bare trailing-colon prefix', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: { allpages: [{ pageid: 508, ns: 2006, title: 'RonzzIT:Main' }] },
			}),
		});
		const ctx = prefixContext(mock, { howitworks: 2002, ronzzit: 2006 });

		await searchPageByPrefix.handle({ prefix: 'RonzzIT:' }, ctx);

		const call = mock.request.mock.calls[0][0];
		expect(call).toMatchObject({ apprefix: '', apnamespace: 2006 });
	});

	it('matches the namespace case-insensitively and honours aliases', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ query: { allpages: [] } }),
		});
		// Localized name "Item" (120) + alias "Image" → 6, matching how a
		// title resolver sees "item:Q42" and "image:X".
		const ctx = prefixContext(mock, { item: 120, image: 6 });

		await searchPageByPrefix.handle({ prefix: 'item:Q4' }, ctx);
		expect(mock.request.mock.calls[0][0]).toMatchObject({ apprefix: 'Q4', apnamespace: 120 });

		await searchPageByPrefix.handle({ prefix: 'IMAGE:X' }, ctx);
		expect(mock.request.mock.calls[1][0]).toMatchObject({ apprefix: 'X', apnamespace: 6 });
	});

	it('rejects a prefix whose namespace contradicts the namespace parameter', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ query: { allpages: [] } }),
		});
		const ctx = prefixContext(mock, { ronzzit: 2006 });

		const result = await searchPageByPrefix.handle({ prefix: 'RonzzIT:Main', namespace: 0 }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('names namespace 2006');
		expect(envelope.message).toContain('namespace parameter is 0');
		expect(mock.request).not.toHaveBeenCalled();
	});

	it('explains an unknown trailing-colon prefix instead of echoing the API error', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ query: { allpages: [] } }),
		});
		// No namespaceNames: the wiki's siteinfo carried none, or the name is unknown.
		const ctx = prefixContext(mock, {});

		const result = await searchPageByPrefix.handle({ prefix: 'Zzz:' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('not a namespace');
		expect(envelope.message).toContain('Zzz');
		expect(mock.request).not.toHaveBeenCalled();
	});

	it('passes a mid-title colon whose first segment is not a namespace through untouched', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ query: { allpages: [] } }),
		});
		const ctx = prefixContext(mock, {});

		await searchPageByPrefix.handle({ prefix: 'Foo:Bar' }, ctx);

		const call = mock.request.mock.calls[0][0];
		expect(call).toMatchObject({ apprefix: 'Foo:Bar' });
		expect(call.apnamespace).toBeUndefined();
	});
});

/** A context whose siteinfo cache carries the given namespace-name map. */
function prefixContext(
	mock: ReturnType<typeof createMockMwn>,
	namespaceNames: Record<string, number>,
) {
	return fakeContext({
		mwn: async () => mock as never,
		siteInfoCache: {
			get: (k: string) =>
				k === 'test-wiki'
					? { server: 'https://test.wiki', articlepath: '/wiki', namespaceNames }
					: undefined,
			set: () => {},
			delete: () => {},
		} as never,
	});
}
