import { z } from 'zod';
import type { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/server';
import type { Tool } from '../runtime/tool.ts';
import { rasteriseSvg, svgAspectRatio } from './svgRender.ts';

const DEFAULT_WIDTH = 1024;
const MAX_WIDTH = 1568;
const MAX_SVG_BYTES = 2_000_000;
const MAX_RENDER_HEIGHT = 4096;

const inputSchema = {
	svg: z
		.string()
		.min(1)
		.describe(
			'Complete SVG source, including the <svg> element. Up to 2 MB. Do not send a data URI or a file path.',
		),
	width: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			'Pixel width of the rendered PNG. Defaults to 1024; values above 1568 are clamped. The height follows the SVG aspect ratio and is capped at 4096 px.',
		),
} as const;

export const renderSvg: Tool<typeof inputSchema> = {
	name: 'render-svg',
	description:
		'Renders SVG source to a PNG server-side and returns the image, without reading or writing the wiki. Use it to look at your own drawing before presenting it: check the rendered image against the request, fix the SVG, and render again. Also returns the rendered dimensions and the declared aspect ratio, so geometry mistakes that are invisible in markup (wrong hidden edges, a mis-placed guide) show up here.',
	inputSchema,
	annotations: {
		title: 'Render SVG',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'render SVG',
	wikiScoped: false,

	async handle({ svg, width }, ctx): Promise<CallToolResult> {
		const bytes = Buffer.byteLength(svg, 'utf8');
		if (bytes > MAX_SVG_BYTES) {
			return ctx.format.invalidInput(
				`The SVG is ${bytes} bytes, over the ${MAX_SVG_BYTES}-byte limit. Reduce the source; a data URI or an embedded raster is not accepted.`,
			);
		}

		const effectiveWidth = Math.min(width ?? DEFAULT_WIDTH, MAX_WIDTH);
		const ratio = svgAspectRatio(svg);
		if (ratio !== undefined && effectiveWidth * ratio > MAX_RENDER_HEIGHT) {
			const suggested = Math.max(1, Math.floor(MAX_RENDER_HEIGHT / ratio));
			return ctx.format.invalidInput(
				`The SVG aspect ratio would render ${Math.round(effectiveWidth * ratio)} px tall at ${effectiveWidth} px wide, over the ${MAX_RENDER_HEIGHT} px limit. Request width ${suggested} or less, or fix the viewBox.`,
			);
		}

		let rendered: { png: Buffer; width: number; height: number };
		try {
			rendered = rasteriseSvg(svg, effectiveWidth);
		} catch (error) {
			return ctx.format.invalidInput(
				`Could not render the SVG: ${error instanceof Error ? error.message : String(error)}.`,
			);
		}

		if (rendered.height > MAX_RENDER_HEIGHT) {
			return ctx.format.invalidInput(
				`Rendered at ${rendered.width}×${rendered.height} px, over the ${MAX_RENDER_HEIGHT} px height limit. Request a smaller width or fix the viewBox.`,
			);
		}

		const declared = ratio !== undefined ? `, aspect ${ratio.toFixed(3)}` : '';
		const sizeKb = Math.max(1, Math.round(rendered.png.length / 1024));
		const caption: TextContent = {
			type: 'text',
			text: `Rendered SVG • image/png • ${rendered.width}×${rendered.height}${declared} • ${sizeKb} KB encoded`,
		};
		const image: ImageContent = {
			type: 'image',
			data: rendered.png.toString('base64'),
			mimeType: 'image/png',
		};

		return { content: [caption, image] };
	},
};
