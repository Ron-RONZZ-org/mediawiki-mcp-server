import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext } from '../helpers/fakeContext.ts';
import { getFileInfo } from '../../src/tools/get-file-info.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { formatPayload } from '../../src/results/format.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

function mwnWithImageinfo(imageinfo: Record<string, unknown>) {
	return createMockMwn({
		request: vi.fn().mockResolvedValue({
			query: {
				pages: [{ title: 'File:Example.png', imageinfo: [imageinfo] }],
			},
		}),
	});
}

describe('get-file-info', () => {
	it('returns file info using action=query&prop=imageinfo', async () => {
		const mock = mwnWithImageinfo({
			url: 'https://test.wiki/images/example.png',
			descriptionurl: 'https://test.wiki/wiki/File:Example.png',
			size: 12345,
			width: 800,
			height: 600,
			mime: 'image/png',
			timestamp: '2026-01-01T00:00:00Z',
			user: 'Admin',
			thumburl: 'https://test.wiki/images/thumb/example.png/200px-example.png',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileInfo.handle({ title: 'Example.png' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toBe(
			formatPayload({
				title: 'File:Example.png',
				descriptionUrl: 'https://test.wiki/wiki/File:Example.png',
				timestamp: '2026-01-01T00:00:00Z',
				user: 'Admin',
				size: 12345,
				mime: 'image/png',
				url: 'https://test.wiki/images/example.png',
				thumbnailUrl: 'https://test.wiki/images/thumb/example.png/200px-example.png',
				contentFormats: ['image'],
			}),
		);
	});

	it('advertises both forms for SVG', async () => {
		const mock = mwnWithImageinfo({
			url: 'https://test.wiki/images/diagram.svg',
			descriptionurl: 'https://test.wiki/wiki/File:Diagram.svg',
			size: 4606,
			width: 960,
			height: 720,
			mime: 'image/svg+xml',
			thumburl: 'https://test.wiki/images/diagram.svg',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileInfo.handle({ title: 'Diagram.svg' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Content formats:');
		expect(text).toContain('- image');
		expect(text).toContain('- source');
	});

	it('advertises source only for PDF', async () => {
		const mock = mwnWithImageinfo({
			url: 'https://test.wiki/images/doc.pdf',
			descriptionurl: 'https://test.wiki/wiki/File:Doc.pdf',
			size: 99999,
			width: 612,
			height: 792,
			mime: 'application/pdf',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileInfo.handle({ title: 'Doc.pdf' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Content formats:');
		expect(text).toContain('- source');
		expect(text).not.toContain('- image');
	});

	it('advertises no forms for a binary', async () => {
		const mock = mwnWithImageinfo({
			url: 'https://test.wiki/images/sound.ogg',
			descriptionurl: 'https://test.wiki/wiki/File:Sound.ogg',
			size: 4242,
			mime: 'audio/ogg',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileInfo.handle({ title: 'Sound.ogg' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Content formats: (none)');
	});

	it('handles missing files', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({
				query: {
					pages: [
						{
							title: 'File:Missing.png',
							missing: true,
						},
					],
				},
			}),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileInfo.handle({ title: 'Missing.png' }, ctx);

		const envelope = assertStructuredError(result, 'not_found');
		expect(envelope.message).toContain('not found');
	});

	it('returns error on API failure via dispatcher', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockRejectedValue(new Error('API error')),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await dispatch(getFileInfo, ctx)({ title: 'Example.png' });

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('API error');
	});
});
