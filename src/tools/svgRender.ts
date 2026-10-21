import { Resvg } from '@resvg/resvg-js';

export interface RasterisedSvg {
	png: Buffer;
	width: number;
	height: number;
}

/**
 * Rasterise SVG source to a PNG at the requested width.
 *
 * Fonts resolve to the container's DejaVu set (installed in the image), so a
 * generated figure keeps its text when it is rendered outside the model.
 */
export function rasteriseSvg(bytes: Buffer | string, width: number): RasterisedSvg {
	const resvg = new Resvg(bytes, {
		fitTo: { mode: 'width', value: width },
		font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Serif' },
	});
	const rendered = resvg.render();
	return {
		png: Buffer.from(rendered.asPng()),
		width: rendered.width,
		height: rendered.height,
	};
}

const SVG_ROOT_RE = /<svg\b([^>]*)>/i;
const VIEW_BOX_RE = /\bviewBox\s*=\s*["']([^"']+)["']/i;
const WIDTH_RE = /\bwidth\s*=\s*["']\s*([0-9]*\.?[0-9]+)/i;
const HEIGHT_RE = /\bheight\s*=\s*["']\s*([0-9]*\.?[0-9]+)/i;

/**
 * Height-to-width ratio declared by the SVG root, before rasterising.
 *
 * Rasterising scales the bitmap from this ratio, so a pathological figure
 * (a very tall viewBox) allocates a huge bitmap at any requested width. The
 * caller uses this to reject such input before resvg allocates it. `undefined`
 * means the root declares no usable size; resvg then applies its own default.
 */
export function svgAspectRatio(svg: string): number | undefined {
	const root = SVG_ROOT_RE.exec(svg)?.[1];
	if (root === undefined) {
		return undefined;
	}

	const viewBox = VIEW_BOX_RE.exec(root)?.[1];
	if (viewBox !== undefined) {
		const parts = viewBox
			.trim()
			.split(/[\s,]+/)
			.map((part) => Number.parseFloat(part));
		if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
			const width = parts[2] ?? 0;
			const height = parts[3] ?? 0;
			if (width > 0 && height > 0) {
				return height / width;
			}
		}
	}

	const width = Number.parseFloat(WIDTH_RE.exec(root)?.[1] ?? '');
	const height = Number.parseFloat(HEIGHT_RE.exec(root)?.[1] ?? '');
	if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
		return height / width;
	}
	return undefined;
}
