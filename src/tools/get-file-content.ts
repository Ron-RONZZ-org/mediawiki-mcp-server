import { z } from 'zod';
import { extractText, getDocumentProxy } from 'unpdf';
import type { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/server';
import type { ApiPage, ImageInfo } from 'mwn';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import { truncateByBytes } from '../results/truncation.ts';
import {
	contentFormatsFor,
	isPdfMime,
	isRasterImageMime,
	isSvgMime,
	isTextSourceMime,
	selectForms,
	sourceUrlFor,
} from './fileContent.ts';
import { rasteriseSvg } from './svgRender.ts';

const DEFAULT_IMAGE_WIDTH = 1024;
const MAX_WIDTH = 1568;
const DEFAULT_FILE_DATA_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

// Operator-owned transport/safety backstop on the encoded payload size. Distinct
// from MCP_CONTENT_MAX_BYTES (a text-body cap) — binary can't be truncated, so
// over-cap is a hard error, not a trailing marker.
function resolveFileDataMaxBytes(): number {
	const raw = process.env.MCP_FILE_DATA_MAX_BYTES;
	if (raw === undefined || raw === '') {
		return DEFAULT_FILE_DATA_MAX_BYTES;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_FILE_DATA_MAX_BYTES;
	}
	return parsed;
}

async function extractPdfText(bytes: Buffer): Promise<{ text: string; pages: number }> {
	const pdf = await getDocumentProxy(new Uint8Array(bytes));
	try {
		const { totalPages, text } = await extractText(pdf, { mergePages: true });
		return { text, pages: totalPages };
	} finally {
		// pdf.js exposes destroy() at runtime; the wrapper's type omits it.
		await (pdf as typeof pdf & { destroy?: () => Promise<void> }).destroy?.();
	}
}

function sameOrigin(url: string, apiUrl: string | undefined): boolean {
	if (apiUrl === undefined) {
		return false;
	}
	try {
		return new URL(url).origin === new URL(apiUrl).origin;
	} catch {
		return false;
	}
}

const inputSchema = {
	title: z.string().describe('File title (with or without the "File:" prefix)'),
	width: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			'Pixel width of the rendered image. Used for raster images and for SVG rasterisation; ignored for source-only requests. Defaults to 1024; values above 1568 are clamped.',
		),
	format: z
		.enum(['auto', 'image', 'source', 'both'])
		.default('auto')
		.describe(
			'Omit or "auto" (default) for the form that fits the file: a viewable image for raster images and SVG, otherwise the text source. "image" requests a raster (SVG is rendered to PNG). "source" requests the decoded source (SVG XML, text, PDF text). "both" returns every form the file supports. See contentFormats from get-file-info.',
		),
} as const;

export const getFileContent: Tool<typeof inputSchema> = {
	name: 'get-file-content',
	description:
		"Fetches a wiki file's content server-side for model consumption. Omit format for automatic behaviour: raster images and SVG come back as image blocks, text-like files and PDFs come back as text. SVG is rasterised to PNG for the image form and its XML is available as the source form. PDFs are returned as extracted text (no page image). contentFormats on get-file-info lists the forms a file supports. Non-renderable types (audio, video, arbitrary binaries) error and point to get-file-info.",
	inputSchema,
	annotations: {
		title: 'Get file content',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'fetch file content',
	target: (a) => a.title,

	async handle({ title, width, format }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const fileTitle = title.startsWith('File:') ? title : `File:${title}`;
		const effectiveWidth = Math.min(width ?? DEFAULT_IMAGE_WIDTH, MAX_WIDTH);

		const response = await mwn.request({
			action: 'query',
			titles: fileTitle,
			prop: 'imageinfo',
			iiprop: 'url|size|mime',
			iiurlwidth: effectiveWidth,
			formatversion: '2',
		});

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mwn API response shape; trusted at this boundary
		const page = response.query?.pages?.[0] as ApiPage | undefined;
		if (!page || page.missing) {
			return ctx.format.notFound(`File "${title}" not found`);
		}

		const info: ImageInfo | undefined = page.imageinfo?.[0];
		if (!info) {
			return ctx.format.notFound(`No file info available for "${title}"`);
		}

		const selection = selectForms(format, info.mime);
		if ('error' in selection) {
			return ctx.format.invalidInput(selection.error);
		}
		const requestedForms = selection.forms;
		const supportedForms = contentFormatsFor(info.mime);
		const fetchUrl = sourceUrlFor(info, requestedForms);
		if (fetchUrl === undefined) {
			return ctx.format.invalidInput(`File "${title}" has no download URL.`);
		}

		// Fetch via mwn (the same client that read the metadata) so auth and host
		// trust match. The URL comes from the trusted configured wiki's own
		// imageinfo, so — unlike a user-supplied URL (add-wiki / discovery, which
		// go through httpFetch's assertPublicDestination guard) — it is
		// intentionally not SSRF-guarded.
		const fetchHeaders: Record<string, string> = {};
		if (
			mwn.usingOAuth2 &&
			typeof mwn.options.OAuth2AccessToken === 'string' &&
			sameOrigin(fetchUrl, mwn.options.apiUrl)
		) {
			fetchHeaders.Authorization = `Bearer ${mwn.options.OAuth2AccessToken}`;
		}

		const axiosResponse = await mwn.rawRequest({
			url: fetchUrl,
			method: 'GET',
			responseType: 'arraybuffer',
			maxRedirects: MAX_REDIRECTS,
			headers: fetchHeaders,
		});
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- axios arraybuffer body at this boundary
		const bytes = Buffer.from(axiosResponse.data as ArrayBuffer);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- axios response headers at this boundary
		const headers = (axiosResponse.headers ?? {}) as Record<string, unknown>;
		const rawContentType = headers['content-type'];
		const responseMime =
			typeof rawContentType === 'string' ? rawContentType.split(';')[0]?.trim() : undefined;

		let image: (ImageContent & { width?: number; height?: number }) | undefined;
		let imageError: string | undefined;
		let source: { text: string; pages?: number } | undefined;
		let sourceError: string | undefined;

		if (requestedForms.includes('image')) {
			try {
				if (isSvgMime(info.mime)) {
					const rendered = rasteriseSvg(bytes, effectiveWidth);
					image = {
						type: 'image',
						data: rendered.png.toString('base64'),
						mimeType: 'image/png',
						width: rendered.width,
						height: rendered.height,
					};
				} else if (isRasterImageMime(info.mime)) {
					const mimeType =
						responseMime !== undefined && responseMime.startsWith('image/')
							? responseMime
							: info.mime;
					if (mimeType === undefined || !mimeType.startsWith('image/')) {
						imageError = `Fetched bytes are not an image (${responseMime ?? info.mime ?? 'unknown type'}).`;
					} else {
						const thumb = info as ImageInfo & {
							thumbwidth?: number;
							thumbheight?: number;
						};
						image = {
							type: 'image',
							data: bytes.toString('base64'),
							mimeType,
							width: thumb.thumbwidth ?? info.width,
							height: thumb.thumbheight ?? info.height,
						};
					}
				} else {
					imageError = `File type "${info.mime ?? 'unknown'}" has no image form.`;
				}
			} catch (error) {
				imageError = `Could not render the image: ${error instanceof Error ? error.message : String(error)}.`;
			}
		}

		if (requestedForms.includes('source')) {
			try {
				if (isPdfMime(info.mime)) {
					const extracted = await extractPdfText(bytes);
					source = { text: extracted.text, pages: extracted.pages };
				} else if (isSvgMime(info.mime) || isTextSourceMime(info.mime)) {
					source = { text: bytes.toString('utf8') };
				} else {
					sourceError = `File type "${info.mime ?? 'unknown'}" has no text source.`;
				}
			} catch (error) {
				sourceError = `Could not extract the source: ${error instanceof Error ? error.message : String(error)}.`;
			}
		}

		// `auto` asked for the best single form. If the image form is unavailable,
		// fall back to the source instead of failing the call.
		if (format === 'auto' && image === undefined && supportedForms.includes('source')) {
			try {
				if (isPdfMime(info.mime)) {
					const extracted = await extractPdfText(bytes);
					source = { text: extracted.text, pages: extracted.pages };
				} else {
					source = { text: bytes.toString('utf8') };
				}
			} catch (error) {
				sourceError = `Could not extract the source: ${error instanceof Error ? error.message : String(error)}.`;
			}
		}

		if (format === 'image' && image === undefined) {
			return ctx.format.invalidInput(
				`${imageError ?? 'No image form is available.'} Use format="source" for the text source, or get-file-info for metadata.`,
			);
		}
		if (format === 'source' && source === undefined) {
			return ctx.format.invalidInput(
				`${sourceError ?? 'No text source is available.'} Use format="image" for a raster, or get-file-info for metadata.`,
			);
		}
		if (image === undefined && source === undefined) {
			const supportedLabel = supportedForms.length > 0 ? supportedForms.join(', ') : 'none';
			const reason =
				[imageError, sourceError].filter(Boolean).join(' ') || 'No content form is available.';
			return ctx.format.invalidInput(
				`${reason} Supported formats: ${supportedLabel}. Use get-file-info for metadata and the download URL.`,
			);
		}

		const wikiKey = ctx.activeWiki.get().key;
		const captionParts = [`File: ${page.title}`, `Wiki: ${wikiKey}`];
		const content: Array<TextContent | ImageContent> = [];

		if (image !== undefined) {
			const encodedBytes = image.data.length;
			const maxBytes = resolveFileDataMaxBytes();
			if (encodedBytes > maxBytes) {
				return ctx.format.invalidInput(
					`Encoded file data is ${encodedBytes} bytes, over the ${maxBytes}-byte limit (MCP_FILE_DATA_MAX_BYTES). Request a smaller width.`,
				);
			}
			const dims =
				image.width !== undefined && image.height !== undefined
					? `${image.width}×${image.height}`
					: 'unknown size';
			const sizeKb = Math.max(1, Math.round(encodedBytes / 1024));
			captionParts.push(`Image: ${image.mimeType} • ${dims}, ${sizeKb} KB encoded`);
		}

		if (imageError !== undefined && format !== 'image') {
			captionParts.push(`Image unavailable: ${imageError}`);
		}
		if (sourceError !== undefined && format !== 'source') {
			captionParts.push(`Source unavailable: ${sourceError}`);
		}

		if (source !== undefined) {
			const truncated = truncateByBytes(source.text);
			const sizeKb = Math.max(1, Math.round(Buffer.byteLength(source.text, 'utf8') / 1024));
			const pages = source.pages !== undefined ? `${source.pages} pages, ` : '';
			captionParts.push(`Source: ${info.mime ?? 'text/plain'} • ${pages}${sizeKb} KB text`);
			source = {
				...source,
				text: truncated.truncated
					? `${truncated.text}\n\n[source truncated at ${truncated.returnedBytes} of ${truncated.totalBytes} bytes]`
					: truncated.text,
			};
		}

		content.push({ type: 'text', text: captionParts.join(' • ') });
		if (image !== undefined) {
			content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
		}
		if (source !== undefined) {
			content.push({ type: 'text', text: source.text });
		}

		// No structuredContent: the dispatcher echoes the wiki key by re-wrapping a
		// plain-object structuredContent into a single text block, which would drop
		// the image block. The wiki key is in the caption instead.
		return { content };
	},
};
