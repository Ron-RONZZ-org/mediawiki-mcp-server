import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ImageContent, TextContent } from '@modelcontextprotocol/server';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext } from '../helpers/fakeContext.ts';
import { getFileContent } from '../../src/tools/get-file-content.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { assertStructuredError } from '../helpers/structuredResult.ts';

vi.mock('unpdf', () => ({
	getDocumentProxy: vi.fn(async () => ({ destroy: vi.fn(async () => {}) })),
	extractText: vi.fn(async () => ({ totalPages: 2, text: 'Hello from PDF' })),
}));

// Build an action=query&prop=imageinfo response.
function imageinfoResponse(
	info: Record<string, unknown>,
	opts: { missing?: boolean } = {},
): unknown {
	return {
		query: {
			pages: [
				opts.missing
					? { title: 'File:Missing.png', missing: true }
					: { title: 'File:Example.png', imageinfo: [info] },
			],
		},
	};
}

const PNG_INFO = {
	url: 'https://test.wiki/images/example.png',
	descriptionurl: 'https://test.wiki/wiki/File:Example.png',
	size: 12345,
	width: 800,
	height: 600,
	mime: 'image/png',
	thumburl: 'https://test.wiki/images/thumb/example.png/1024px-example.png',
	thumbwidth: 1024,
	thumbheight: 768,
};

const SVG_INFO = {
	url: 'https://test.wiki/images/diagram.svg',
	descriptionurl: 'https://test.wiki/wiki/File:Diagram.svg',
	size: 4606,
	width: 960,
	height: 720,
	mime: 'image/svg+xml',
	// MediaWiki with $wgSVGNativeRendering serves the original as the thumb.
	thumburl: 'https://test.wiki/images/diagram.svg',
	thumbwidth: 960,
	thumbheight: 720,
};

const PDF_INFO = {
	url: 'https://test.wiki/images/doc.pdf',
	descriptionurl: 'https://test.wiki/wiki/File:Doc.pdf',
	size: 99999,
	width: 612,
	height: 792,
	mime: 'application/pdf',
};

const AUDIO_INFO = {
	url: 'https://test.wiki/images/sound.ogg',
	descriptionurl: 'https://test.wiki/wiki/File:Sound.ogg',
	size: 4242,
	mime: 'audio/ogg',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_BYTES = Buffer.from('fake-image-bytes');
const SVG_BYTES = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="white"/><text x="10" y="30" font-size="12">hi</text></svg>',
);

function mwnWith(
	info: Record<string, unknown>,
	opts: { missing?: boolean; bytes?: Buffer; contentType?: string } = {},
) {
	return createMockMwn({
		request: vi.fn().mockResolvedValue(imageinfoResponse(info, opts)),
		rawRequest: vi.fn().mockResolvedValue({
			data: opts.bytes ?? FAKE_BYTES,
			headers: { 'content-type': opts.contentType ?? 'image/png' },
		}),
	});
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('get-file-content', () => {
	it('returns an image content block for a raster image', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		const caption = result.content[0] as TextContent;
		const payload = result.content[1] as ImageContent;
		expect(caption.type).toBe('text');
		expect(caption.text).toContain('test-wiki');
		expect(caption.text).toContain('Image: image/png');
		expect(caption.text).toContain('1024×768');
		expect(payload.type).toBe('image');
		expect(payload.mimeType).toBe('image/png');
		expect(payload.data).toBe(FAKE_BYTES.toString('base64'));
		expect(mock.rawRequest).toHaveBeenCalledWith(
			expect.objectContaining({ url: PNG_INFO.thumburl, responseType: 'arraybuffer' }),
		);
	});

	it('defaults to auto and returns the image for a raster', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'auto' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
	});

	it('rasterises SVG to PNG for the image form', async () => {
		const mock = mwnWith(SVG_INFO, { bytes: SVG_BYTES, contentType: 'image/svg+xml' });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'image' }, ctx);

		expect(result.isError).toBeFalsy();
		const payload = result.content[1] as ImageContent;
		expect(payload.type).toBe('image');
		expect(payload.mimeType).toBe('image/png');
		const png = Buffer.from(payload.data, 'base64');
		expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
	});

	it('returns the SVG source for the source form', async () => {
		const mock = mwnWith(SVG_INFO, { bytes: SVG_BYTES, contentType: 'image/svg+xml' });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'source' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		const source = result.content[1] as TextContent;
		expect(source.type).toBe('text');
		expect(source.text).toContain('<svg');
		expect(mock.rawRequest).toHaveBeenCalledWith(
			expect.objectContaining({ url: SVG_INFO.url, responseType: 'arraybuffer' }),
		);
	});

	it('returns both the PNG and the SVG source for both', async () => {
		const mock = mwnWith(SVG_INFO, { bytes: SVG_BYTES, contentType: 'image/svg+xml' });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'both' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(3);
		expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
		expect((result.content[2] as TextContent).text).toContain('<svg');
	});

	it('auto on SVG returns the image only', async () => {
		const mock = mwnWith(SVG_INFO, { bytes: SVG_BYTES, contentType: 'image/svg+xml' });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'auto' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
	});

	it('falls back to SVG source when rasterisation fails in auto mode', async () => {
		const mock = mwnWith(SVG_INFO, {
			bytes: Buffer.from('<svg>not valid</svg>'),
			contentType: 'image/svg+xml',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'auto' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		expect((result.content[1] as TextContent).text).toContain('<svg>');
		expect((result.content[0] as TextContent).text).toContain('Image unavailable');
	});

	it('rejects an explicit image request for an SVG that cannot render', async () => {
		const mock = mwnWith(SVG_INFO, {
			bytes: Buffer.from('<svg>not valid</svg>'),
			contentType: 'image/svg+xml',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Diagram.svg', format: 'image' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('format="source"');
	});

	it('rejects source for a raster image and names the supported form', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'source' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('no source form');
		expect(envelope.message).toContain('Supported formats: image');
		expect(mock.rawRequest).not.toHaveBeenCalled();
	});

	it('rejects image for a PDF and names the supported form', async () => {
		const mock = mwnWith(PDF_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Doc.pdf', format: 'image' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('no image form');
		expect(envelope.message).toContain('Supported formats: source');
		expect(mock.rawRequest).not.toHaveBeenCalled();
	});

	it('extracts PDF text for source', async () => {
		const mock = mwnWith(PDF_INFO, {
			bytes: Buffer.from('%PDF-fake'),
			contentType: 'application/pdf',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Doc.pdf', format: 'source' }, ctx);

		expect(result.isError).toBeFalsy();
		const caption = result.content[0] as TextContent;
		const source = result.content[1] as TextContent;
		expect(caption.text).toContain('Source: application/pdf');
		expect(caption.text).toContain('2 pages');
		expect(source.text).toBe('Hello from PDF');
	});

	it('auto on a PDF returns extracted text', async () => {
		const mock = mwnWith(PDF_INFO, {
			bytes: Buffer.from('%PDF-fake'),
			contentType: 'application/pdf',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Doc.pdf', format: 'auto' }, ctx);

		expect(result.isError).toBeFalsy();
		expect((result.content[1] as TextContent).text).toBe('Hello from PDF');
	});

	it('both on a PDF returns the available source only', async () => {
		const mock = mwnWith(PDF_INFO, {
			bytes: Buffer.from('%PDF-fake'),
			contentType: 'application/pdf',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Doc.pdf', format: 'both' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		expect((result.content[1] as TextContent).text).toBe('Hello from PDF');
	});

	it('both on a raster returns the image only', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'both' }, ctx);

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		expect(result.content[1]).toMatchObject({ type: 'image' });
	});

	it('rejects a non-renderable file and points to get-file-info', async () => {
		const mock = mwnWith(AUDIO_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Sound.ogg', format: 'image' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('no model-consumable form');
		expect(envelope.message).toContain('get-file-info');
		expect(mock.rawRequest).not.toHaveBeenCalled();
	});

	it('attaches the OAuth2 bearer when the file is same-origin as the wiki API', async () => {
		const mock = mwnWith(PNG_INFO);
		mock.usingOAuth2 = true;
		mock.options = { apiUrl: 'https://test.wiki/w/api.php', OAuth2AccessToken: 'secret-token' };
		const ctx = fakeContext({ mwn: async () => mock as never });

		await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		expect(mock.rawRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
			}),
		);
	});

	it('does not leak the bearer to a different-origin file host', async () => {
		const mock = mwnWith({
			...PNG_INFO,
			thumburl: 'https://cdn.example.org/thumb/example.png/1024px-example.png',
		});
		mock.usingOAuth2 = true;
		mock.options = { apiUrl: 'https://test.wiki/w/api.php', OAuth2AccessToken: 'secret-token' };
		const ctx = fakeContext({ mwn: async () => mock as never });

		await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		const firstCallArg = mock.rawRequest.mock.calls[0][0] as { headers?: Record<string, string> };
		expect(firstCallArg.headers?.Authorization).toBeUndefined();
	});

	it('preserves the image block through the dispatcher', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await dispatch(
			getFileContent,
			ctx,
		)({
			title: 'Example.png',
			format: 'image',
		});

		expect(result.isError).toBeFalsy();
		expect(result.content).toHaveLength(2);
		expect(result.content[0].type).toBe('text');
		const payload = result.content[1] as ImageContent;
		expect(payload.type).toBe('image');
		expect(payload.data).toBe(FAKE_BYTES.toString('base64'));
		expect((result.content[0] as TextContent).text).toContain('test-wiki');
	});

	it('falls back to the original mime when the response has no content-type', async () => {
		const mock = mwnWith(PNG_INFO);
		mock.rawRequest = vi.fn().mockResolvedValue({ data: FAKE_BYTES, headers: {} });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		expect(result.isError).toBeFalsy();
		const payload = result.content[1] as ImageContent;
		expect(payload.type).toBe('image');
		expect(payload.mimeType).toBe('image/png');
	});

	it('defaults width to 1024 in image mode and passes it to iiurlwidth', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ iiurlwidth: 1024 }));
	});

	it('clamps width to 1568', async () => {
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		await getFileContent.handle({ title: 'Example.png', width: 5000, format: 'image' }, ctx);

		expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({ iiurlwidth: 1568 }));
	});

	it('rejects an over-cap image payload with invalid_input mentioning width', async () => {
		vi.stubEnv('MCP_FILE_DATA_MAX_BYTES', '4');
		const mock = mwnWith(PNG_INFO);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Example.png', format: 'image' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message.toLowerCase()).toContain('width');
	});

	it('returns not_found for a missing file', async () => {
		const mock = mwnWith({}, { missing: true });
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileContent.handle({ title: 'Missing.png', format: 'image' }, ctx);

		const envelope = assertStructuredError(result, 'not_found');
		expect(envelope.message).toContain('not found');
	});

	it('classifies upstream API failure via the dispatcher', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockRejectedValue(new Error('API error')),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await dispatch(
			getFileContent,
			ctx,
		)({
			title: 'Example.png',
			format: 'image',
		});

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('API error');
	});
});
