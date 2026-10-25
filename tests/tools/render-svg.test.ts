import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ImageContent, TextContent } from '@modelcontextprotocol/server';
import { renderSvg } from '../../src/tools/render-svg.ts';
import { svgAspectRatio } from '../../src/tools/svgRender.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { fakeContext } from '../helpers/fakeContext.ts';
import { UploadDirsImpl } from '../../src/wikis/uploadDirs.ts';

const SIMPLE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
	'<rect width="100" height="50" fill="white"/><text x="10" y="30" font-size="12">hi</text></svg>';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function run(args: Record<string, unknown>) {
	return dispatch(renderSvg, fakeContext())(args as never);
}

describe('render-svg', () => {
	it('renders SVG source and returns a PNG image block', async () => {
		const result = await run({ svg: SIMPLE_SVG });

		expect(result.isError).toBeUndefined();
		expect(result.content).toHaveLength(2);

		const caption = result.content[0] as TextContent;
		expect(caption.type).toBe('text');
		expect(caption.text).toContain('image/png');
		expect(caption.text).toContain('1024×512');

		const image = result.content[1] as ImageContent;
		expect(image.type).toBe('image');
		expect(image.mimeType).toBe('image/png');
		const bytes = Buffer.from(image.data, 'base64');
		expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
	});

	it('clamps the requested width to 1568 px', async () => {
		const result = await run({ svg: SIMPLE_SVG, width: 5000 });

		const caption = result.content[0] as TextContent;
		expect(caption.text).toContain('1568×784');
	});

	it('rejects an SVG over the size limit before rendering', async () => {
		const result = await run({ svg: `<svg>${'a'.repeat(2_000_001)}</svg>` });

		expect(result.isError).toBe(true);
		const caption = result.content[0] as TextContent;
		expect(caption.text).toContain('over the 2000000-byte limit');
	});

	it('rejects a tall aspect ratio before resvg allocates the bitmap', async () => {
		const result = await run({
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10000"><rect width="10" height="10000"/></svg>',
		});

		expect(result.isError).toBe(true);
		const caption = result.content[0] as TextContent;
		expect(caption.text).toContain('over the 4096 px limit');
		expect(caption.text).toContain('Request width 4 or less');
	});

	it('returns invalid input for source that is not an SVG', async () => {
		const result = await run({ svg: 'not an svg' });

		expect(result.isError).toBe(true);
		const caption = result.content[0] as TextContent;
		expect(caption.text).toContain('Could not render the SVG');
	});

	it('renders a figure whose only size is the viewBox', async () => {
		const result = await run({
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><circle cx="50" cy="50" r="40"/></svg>',
		});

		expect(result.isError).toBeUndefined();
		const caption = result.content[0] as TextContent;
		expect(caption.text).toContain('1024×512');
	});
});

describe('svgAspectRatio', () => {
	it('prefers the viewBox ratio', () => {
		expect(svgAspectRatio('<svg viewBox="0 0 200 50"></svg>')).toBe(0.25);
	});

	it('falls back to width and height attributes', () => {
		expect(svgAspectRatio('<svg width="300" height="150"></svg>')).toBe(0.5);
	});

	it('accepts a single-quoted viewBox with commas', () => {
		expect(svgAspectRatio("<svg viewBox='0,0,40,10'></svg>")).toBe(0.25);
	});

	it('returns undefined when the root declares no usable size', () => {
		expect(svgAspectRatio('<svg></svg>')).toBeUndefined();
		expect(svgAspectRatio('no svg here')).toBeUndefined();
		expect(svgAspectRatio('<svg viewBox="0 0 0 10"></svg>')).toBeUndefined();
	});

	it('renders an SVG file from an allowed directory', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'render-svg-'));
		const file = join(dir, 'figure.svg');
		await writeFile(file, SIMPLE_SVG, 'utf8');
		try {
			const result = await dispatch(
				renderSvg,
				fakeContext({ uploadDirs: new UploadDirsImpl([dir]) }),
			)({ path: file } as never);

			expect(result.isError).toBeUndefined();
			const image = result.content[1] as ImageContent;
			const bytes = Buffer.from(image.data, 'base64');
			expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('rejects a path outside the allowed upload directories', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'render-svg-'));
		const file = join(dir, 'figure.svg');
		await writeFile(file, SIMPLE_SVG, 'utf8');
		try {
			const result = await dispatch(
				renderSvg,
				fakeContext({ uploadDirs: new UploadDirsImpl([join(dir, 'other')]) }),
			)({ path: file } as never);

			expect(result.isError).toBe(true);
			const caption = result.content[0] as TextContent;
			expect(caption.text).toContain('outside the allowed upload directories');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('requires exactly one of svg or path', async () => {
		const neither = await run({});
		expect(neither.isError).toBe(true);
		expect((neither.content[0] as TextContent).text).toContain('exactly one of svg');

		const both = await run({ svg: SIMPLE_SVG, path: '/tmp/x.svg' });
		expect(both.isError).toBe(true);
		expect((both.content[0] as TextContent).text).toContain('exactly one of svg');
	});
});
