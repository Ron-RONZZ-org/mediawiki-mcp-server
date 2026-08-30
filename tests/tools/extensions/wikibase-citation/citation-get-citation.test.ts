import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { citationGetCitation } from '../../../../src/tools/extensions/wikibase-citation/citation-get-citation.ts';

describe('citation-get-citation', () => {
	it('requests the citation in the chosen style and returns it', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				entity: 'Q96',
				style: 'apa',
				citation: 'Lovelace, A. (1843). Notes by the Translator.',
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await citationGetCitation.handle(
			toolArgs(citationGetCitation, { entityId: 'Q96' }),
			ctx,
		);

		expect(mock.request.mock.calls[0][0]).toMatchObject({
			action: 'citation',
			entity: 'Q96',
			style: 'apa',
			output: 'text',
		});
		expect(assertStructuredData(result)).toMatchObject({
			entityId: 'Q96',
			style: 'apa',
			citation: 'Lovelace, A. (1843). Notes by the Translator.',
		});
	});

	it('passes a bibtex style and html output through', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ entity: 'Q96', style: 'bibtex', citation: '@book{…}' }),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		await citationGetCitation.handle(
			toolArgs(citationGetCitation, { entityId: 'Q96', style: 'bibtex', output: 'html' }),
			ctx,
		);

		expect(mock.request.mock.calls[0][0]).toMatchObject({ style: 'bibtex', output: 'html' });
	});

	it('returns json style citations as the CSL structure', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				entity: 'Q96',
				style: 'json',
				citation: { type: 'book', title: 'Notes', author: [{ family: 'Lovelace' }] },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await citationGetCitation.handle(
			toolArgs(citationGetCitation, { entityId: 'Q96', style: 'json' }),
			ctx,
		);

		expect(assertStructuredData(result).citation).toMatchObject({ type: 'book' });
	});

	it('reports a citation API response without content as upstream_failure', async () => {
		const mock = createMockMwn({ request: vi.fn().mockResolvedValue({ success: 1 }) });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await citationGetCitation.handle(
			toolArgs(citationGetCitation, { entityId: 'Q999' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});

	it('is annotated as read-only', () => {
		expect(citationGetCitation.annotations.readOnlyHint).toBe(true);
	});
});
