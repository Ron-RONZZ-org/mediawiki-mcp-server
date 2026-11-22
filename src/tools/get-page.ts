import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ApiPage, ApiParams, ApiRevision, Mwn } from 'mwn';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import { buildPageUrl } from '../wikis/utils.ts';
import { readPage, renderPage, type RenderedPage } from '../wikis/readPage.ts';
import { ContentFormat } from '../results/contentFormat.ts';
import {
	pageOutlineThreshold,
	truncateByBytes,
	type TruncatedContent,
	type TruncationInfo,
} from '../results/truncation.ts';
import {
	resolveSectionName,
	toOutlineLines,
	type SectionEntry,
} from '../services/sectionService.ts';
import { omittedContentTruncation, sectionContentTruncation } from '../services/sectionMarker.ts';

const inputSchema = {
	title: z.string().describe('Wiki page title'),
	content: z
		.nativeEnum(ContentFormat)
		.optional()
		.default(ContentFormat.source)
		.describe('Type of content to return'),
	metadata: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			'Whether to include metadata (page ID, revision info, size, section outline) in the response',
		),
	section: z
		.union([z.number().int().nonnegative(), z.string().min(1)])
		.optional()
		.describe(
			'Section number (0 = lead; 1..N = heading sections) or a heading name. Narrows content to one section.',
		),
	full: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			'Read the whole page even when it exceeds the page-outline threshold. Without this, a large whole-page read returns only the outline.',
		),
	maxBytes: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('Cap on the bytes returned for one body. Defaults to MCP_CONTENT_MAX_BYTES.'),
} as const;

type GetPageArgs = z.infer<z.ZodObject<typeof inputSchema>>;
type ResolvedGetPageArgs = Omit<GetPageArgs, 'section'> & { section?: number };

interface PagePayload {
	pageId?: number;
	title?: string;
	latestRevisionId?: number;
	latestRevisionTimestamp?: string;
	contentModel?: string;
	size?: number;
	url?: string;
	sections?: string[];
	source?: string;
	html?: string;
	truncation?: TruncationInfo;
}

type SectionLister = () => Promise<SectionEntry[]>;

export const getPage: Tool<typeof inputSchema> = {
	name: 'get-page',
	description:
		'Returns a single wiki page (wikitext source, rendered HTML, section outline, or metadata only). If the title does not exist, an error is returned. A whole-page source or HTML read above the page-outline threshold returns the outline by default; pass full=true to read the page (truncated at the byte cap) or section=N to read one section. content="outline" always returns only the outline. section accepts a section number or a heading name. Use metadata=true for the revision ID (for edit-conflict detection), page size, and section outline. Content is truncated at MCP_CONTENT_MAX_BYTES (75000 by default); maxBytes lowers that cap for one call. For more than one page at a time, use get-pages. For a specific historical revision, use get-revision.',
	inputSchema,
	annotations: {
		title: 'Get page',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'retrieve page data',
	target: (a) => a.title,

	async handle(args, ctx: ToolContext): Promise<CallToolResult> {
		const validationError = validateArgs(args);
		if (validationError !== undefined) {
			return ctx.format.invalidInput(validationError);
		}

		const mwn = await ctx.mwn();
		const listSections = listSectionsOnce(ctx, mwn, args.title);
		let section = args.section;
		if (typeof section === 'string') {
			const resolution = resolveSectionName(section, await listSections());
			if ('error' in resolution) {
				return ctx.format.invalidInput(resolution.error);
			}
			section = resolution.number;
		}
		const resolved: ResolvedGetPageArgs = { ...args, section };

		const page = await readPage(mwn, args.title, pageReadParams(resolved));
		if (page.missing) {
			return ctx.format.notFound(`Page "${args.title}" not found`);
		}
		const revision = page.revisions?.[0];
		const size = revision?.size;
		const omit =
			args.content !== ContentFormat.none &&
			args.content !== ContentFormat.outline &&
			resolved.section === undefined &&
			!args.full &&
			size !== undefined &&
			size > pageOutlineThreshold();
		if (args.content === ContentFormat.outline || omit) {
			return ctx.format.ok(await outlinePayload(page, revision, ctx, listSections, omit));
		}
		if (args.content === ContentFormat.html) {
			return ctx.format.ok({
				...(args.metadata ? await metadataPayload(page, revision, ctx, listSections) : {}),
				...(await htmlPayload(mwn, resolved, ctx, listSections)),
			});
		}
		return ctx.format.ok(await pageReadPayload(page, resolved, ctx, listSections));
	},
};

function validateArgs({ content, metadata, section, maxBytes }: GetPageArgs): string | undefined {
	if (content === ContentFormat.none && !metadata) {
		return 'When content is set to "none", metadata must be true';
	}
	if (section !== undefined && content === ContentFormat.none) {
		return 'section is not compatible with content="none"';
	}
	if (section !== undefined && content === ContentFormat.outline) {
		return 'section is not compatible with content="outline"';
	}
	if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) {
		return 'maxBytes must be a positive integer';
	}
	return undefined;
}

function listSectionsOnce(ctx: ToolContext, mwn: Mwn, title: string): SectionLister {
	let entries: Promise<SectionEntry[]> | undefined;
	return () => (entries ??= ctx.sections.list(mwn, title));
}

function pageReadParams({
	content,
	section,
}: ResolvedGetPageArgs): ApiParams & { redirects: boolean } {
	if (content === ContentFormat.source) {
		return {
			rvprop: 'ids|timestamp|contentmodel|size|content',
			redirects: true,
			...(section !== undefined ? { rvsection: section } : {}),
		};
	}
	return { rvprop: 'ids|timestamp|contentmodel|size', redirects: true };
}

async function pageReadPayload(
	page: ApiPage,
	args: ResolvedGetPageArgs,
	ctx: ToolContext,
	listSections: SectionLister,
): Promise<PagePayload> {
	const revision = page.revisions?.[0];
	const readsSource = args.content === ContentFormat.source;
	return {
		// A write scoped to a section needs the revision its section number was read from.
		...(readsSource ? { latestRevisionId: revision?.revid } : {}),
		...(args.metadata ? await metadataPayload(page, revision, ctx, listSections) : {}),
		...(readsSource
			? await sourcePayload(revision?.content, args.section, listSections, args.maxBytes)
			: {}),
	};
}

async function outlinePayload(
	page: ApiPage,
	revision: ApiRevision | undefined,
	ctx: ToolContext,
	listSections: SectionLister,
	omit: boolean,
): Promise<PagePayload> {
	const { sections, ...rest } = await metadataPayload(page, revision, ctx, listSections);
	if (!omit || revision?.size === undefined) {
		return { ...rest, sections };
	}
	return {
		...rest,
		truncation: omittedContentTruncation({
			entries: await listSections(),
			totalBytes: revision.size,
			itemNoun: 'wikitext',
			toolName: 'get-page',
		}),
	};
}

async function metadataPayload(
	page: ApiPage,
	revision: ApiRevision | undefined,
	ctx: ToolContext,
	listSections: SectionLister,
): Promise<PagePayload> {
	return {
		pageId: page.pageid,
		title: page.title,
		latestRevisionId: revision?.revid,
		latestRevisionTimestamp: revision?.timestamp,
		contentModel: revision?.contentmodel,
		size: revision?.size,
		sections: toOutlineLines(await listSections(), revision?.size),
		url: await buildPageUrl(ctx, page.title),
	};
}

async function sourcePayload(
	content: string | undefined,
	section: number | undefined,
	listSections: SectionLister,
	maxBytes: number | undefined,
): Promise<PagePayload> {
	if (content === undefined) {
		return {};
	}
	const source = truncateByBytes(content, maxBytes);
	return {
		source: source.text,
		...(await truncationPayload(source, 'wikitext', section, listSections)),
	};
}

async function truncationPayload(
	content: TruncatedContent,
	itemNoun: string,
	section: number | undefined,
	listSections: SectionLister,
): Promise<PagePayload> {
	if (!content.truncated) {
		return {};
	}
	return {
		truncation: sectionContentTruncation({
			entries: await listSections(),
			section,
			itemNoun,
			toolName: 'get-page',
			returnedBytes: content.returnedBytes,
			totalBytes: content.totalBytes,
		}),
	};
}

async function htmlPayload(
	mwn: Mwn,
	args: ResolvedGetPageArgs,
	ctx: ToolContext,
	listSections: SectionLister,
): Promise<PagePayload> {
	const rendered = await renderPage(mwn, {
		page: args.title,
		...(args.section !== undefined ? { section: args.section } : {}),
	});
	if (rendered.html === undefined) {
		return {};
	}
	const html = truncateByBytes(rendered.html, args.maxBytes);
	return {
		html: html.text,
		// Without metadata, the render is the only read that names the page.
		...(args.metadata ? {} : await renderedPageIdentity(rendered, args.title, ctx)),
		...(await truncationPayload(html, 'HTML', args.section, listSections)),
	};
}

async function renderedPageIdentity(
	rendered: RenderedPage,
	requestedTitle: string,
	ctx: ToolContext,
): Promise<PagePayload> {
	const title = rendered.title ?? requestedTitle;
	return {
		title,
		pageId: rendered.pageId,
		url: await buildPageUrl(ctx, title),
	};
}
