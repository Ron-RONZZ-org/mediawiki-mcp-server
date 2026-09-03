import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import { makeApiRequest } from '../transport/httpFetch.ts';

const inputSchema = {
	query: z.string().min(1).describe('Search terms for images (e.g. "Van Gogh sunflowers")'),
	count: z
		.number()
		.int()
		.min(1)
		.max(30)
		.optional()
		.describe('Maximum number of images to return (default 10)'),
	license: z
		.enum(['all', 'no_restrictions'])
		.optional()
		.describe(
			"Filter by licensing: 'all' (default) or 'no_restrictions' (CC0 / public domain only)",
		),
	requireThumbnails: z
		.boolean()
		.optional()
		.describe('Include thumbnail URLs in the results (default true)'),
} as const;

/**
 * One Commons search hit with the metadata a re-user needs: license,
 * author, direct + thumbnail URLs. MediaWiki extmetadata values arrive as
 * { value } objects; Artist/ImageDescription are HTML.
 */
export interface ImageSearchResult {
	title: string;
	pageUrl: string;
	fileUrl?: string;
	thumbUrl?: string;
	width?: number;
	height?: number;
	mime?: string;
	license?: string;
	author?: string;
	credit?: string;
	description?: string;
}

interface ExtMetadata {
	[key: string]: { value?: string } | undefined;
}

interface CommonsPage {
	title?: string;
	imageinfo?: Array<{
		url?: string;
		thumburl?: string;
		width?: number;
		height?: number;
		mime?: string;
		extmetadata?: ExtMetadata;
	}>;
}

interface CommonsApiResponse {
	query?: { pages?: Record<string, CommonsPage> };
	error?: { code?: string; info?: string };
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** Strips HTML tags + decodes entities from MediaWiki extmetadata fields. */
function stripHtml(value: string | undefined): string {
	if (value === undefined) {
		return '';
	}
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&#0?\d+;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function isFreeLicense(license: string): boolean {
	return /public domain|cc0/i.test(license);
}

/** Pure: maps a Commons API response onto ImageSearchResult rows. */
export function parseSearchResponse(
	data: CommonsApiResponse,
	licenseFilter: string,
): ImageSearchResult[] {
	const pages = data.query?.pages ?? {};
	const results: ImageSearchResult[] = [];
	for (const page of Object.values(pages)) {
		const title = page.title ?? '';
		if (!title.startsWith('File:')) {
			continue;
		}
		const info = page.imageinfo?.[0];
		const meta = info?.extmetadata ?? {};
		const license = stripHtml(meta.LicenseShortName?.value) || '';
		if (licenseFilter === 'no_restrictions' && !isFreeLicense(license)) {
			continue;
		}
		results.push({
			title,
			pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
			...(info?.url !== undefined ? { fileUrl: info.url } : {}),
			...(info?.thumburl !== undefined ? { thumbUrl: info.thumburl } : {}),
			...(info?.width !== undefined ? { width: info.width } : {}),
			...(info?.height !== undefined ? { height: info.height } : {}),
			...(info?.mime !== undefined ? { mime: info.mime } : {}),
			...(license !== '' ? { license } : {}),
			...(stripHtml(meta.Artist?.value) !== '' ? { author: stripHtml(meta.Artist?.value) } : {}),
			...(stripHtml(meta.UsageTerms?.value) !== ''
				? { credit: stripHtml(meta.UsageTerms?.value) }
				: {}),
			...(stripHtml(meta.ImageDescription?.value) !== ''
				? { description: stripHtml(meta.ImageDescription?.value) }
				: {}),
		});
	}
	return results;
}

export const imageSearch: Tool<typeof inputSchema> = {
	name: 'image-search',
	description:
		'Searches Wikimedia Commons for freely usable images and returns each match with the metadata a re-user needs: the file page and direct file URL, a thumbnail URL, dimensions and MIME type, and the license + author + credit (attribution requirements). The search runs against the public Commons API and needs no account. Use the results with upload-file-from-url to land a chosen image on a wiki, carrying the license/author into the File page text.',
	inputSchema,
	annotations: {
		title: 'Search images',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'search images',
	target: (a) => a.query,

	async handle(
		{ query, count, license, requireThumbnails },
		ctx: ToolContext,
	): Promise<CallToolResult> {
		const limit = count ?? 10;
		const filter = license ?? 'all';

		const params: Record<string, string> = {
			action: 'query',
			format: 'json',
			formatversion: '2',
			generator: 'search',
			gsrsearch: query,
			gsrnamespace: '6', // File:
			gsrlimit: String(limit),
			prop: 'imageinfo',
			iiprop: 'url|size|mime|extmetadata',
			iiextmetadatafilter: 'LicenseShortName|Artist|UsageTerms|ImageDescription',
		};
		if (requireThumbnails !== false) {
			params.iiurlwidth = '480';
		}

		let data: CommonsApiResponse;
		try {
			data = await makeApiRequest<CommonsApiResponse>(COMMONS_API, params);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return ctx.format.error(
				'upstream_failure',
				`Could not reach the Wikimedia Commons search API: ${message}`,
			);
		}
		if (data.error !== undefined) {
			return ctx.format.error(
				'upstream_failure',
				`The Wikimedia Commons search API rejected the query: ${data.error.info ?? data.error.code ?? 'unknown error'}`,
			);
		}

		const results = parseSearchResponse(data, filter);
		return ctx.format.ok({
			query,
			license: filter,
			count: results.length,
			results,
			...(results.length === 0
				? {
						note: 'No matches; the Commons search may have returned fewer than the requested count.',
					}
				: {}),
		});
	},
};
