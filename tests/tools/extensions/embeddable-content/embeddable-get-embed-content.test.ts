import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { embeddableGetEmbedContent } from '../../../../src/tools/extensions/embeddable-content/embeddable-get-embed-content.ts';

describe('embeddable-get-embed-content', () => {
	it('renders an item through the embed API and returns the fragment', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				embed: {
					kind: 'quotation',
					title: 'Ada was first',
					lang: 'en',
					html: '<blockquote>Ada was first.</blockquote>',
				},
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await embeddableGetEmbedContent.handle(
			toolArgs(embeddableGetEmbedContent, { entityId: 'Q777' }),
			ctx,
		);

		expect(mock.request.mock.calls[0][0]).toMatchObject({
			action: 'embed',
			entity: 'Q777',
			output: 'html',
		});
		expect(assertStructuredData(result)).toMatchObject({
			entityId: 'Q777',
			kind: 'quotation',
			html: '<blockquote>Ada was first.</blockquote>',
		});
	});

	it('passes json output and a language through', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				embed: { kind: 'quotation', lang: 'fr', html: '<q>…</q>', languages: ['fr', 'en'] },
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		await embeddableGetEmbedContent.handle(
			toolArgs(embeddableGetEmbedContent, { entityId: 'Q777', output: 'json', language: 'fr' }),
			ctx,
		);

		expect(mock.request.mock.calls[0][0]).toMatchObject({ output: 'json', lang: 'fr' });
	});

	it('reports an embed API response without content as upstream_failure', async () => {
		const mock = createMockMwn({ request: vi.fn().mockResolvedValue({ success: 1 }) });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await embeddableGetEmbedContent.handle(
			toolArgs(embeddableGetEmbedContent, { entityId: 'Q999' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});

	it('is annotated as read-only', () => {
		expect(embeddableGetEmbedContent.annotations.readOnlyHint).toBe(true);
	});
});
