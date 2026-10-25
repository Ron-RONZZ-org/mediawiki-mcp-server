import type { ApiUploadResponse, Mwn } from 'mwn';
import type { ApiUploadParams } from 'types-mediawiki-api';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ToolContext } from '../runtime/context.ts';
import { errorMessage } from '../errors/errorMessage.ts';
import { fetchFileBytes, shouldRescueToWiki } from '../outbound/httpFetch.ts';
import { buildPageUrl } from './utils.ts';

export interface UrlUpload {
	url: string;
	title: string;
	text: string;
	params: ApiUploadParams;
}

/** The fields every successful upload reports, before any tool-specific extras. */
export interface UploadedPayload {
	filename: string;
	pageUrl: string;
	fileUrl?: string;
}

export async function uploadedPayload(
	ctx: ToolContext,
	data: ApiUploadResponse,
	title: string,
): Promise<UploadedPayload> {
	const imageinfo = (
		data as ApiUploadResponse & {
			imageinfo?: { descriptionurl?: string; url?: string };
		}
	).imageinfo;
	const filename = data.filename ?? title.replace(/^File:/, '');
	return {
		filename,
		pageUrl: imageinfo?.descriptionurl ?? (await buildPageUrl(ctx, `File:${filename}`)),
		...(imageinfo?.url !== undefined ? { fileUrl: imageinfo.url } : {}),
	};
}

export async function uploadedFile(
	ctx: ToolContext,
	data: ApiUploadResponse,
	title: string,
): Promise<CallToolResult> {
	return ctx.format.ok(await uploadedPayload(ctx, data, title));
}

// Server-first: fetch the bytes ourselves (SSRF-guarded, size-capped) and upload
// them as a normal multipart request, so the wiki needs no copy-upload config or
// upload_by_url right. Only a URL the server cannot reach, or a file over its
// size cap, is left for the wiki to fetch.
//
// `decorate` runs after a successful upload and its fields are merged into the
// response. The image-facts tools use it to attach the item id or a warning
// without reimplementing the upload path.
export async function uploadFromUrl(
	ctx: ToolContext,
	mwn: Mwn,
	{ url, title, text, params }: UrlUpload,
	decorate?: (payload: UploadedPayload) => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
	const finish = async (data: ApiUploadResponse): Promise<CallToolResult> => {
		const payload = await uploadedPayload(ctx, data, title);
		const extra = decorate === undefined ? {} : await decorate(payload);
		return ctx.format.ok({ ...payload, ...extra });
	};

	let bytes: Buffer | undefined;
	try {
		bytes = await fetchFileBytes(url);
	} catch (error) {
		if (!shouldRescueToWiki(error)) {
			throw error;
		}
	}

	if (bytes !== undefined) {
		const partName = title.replace(/^File:/, '');
		const data = await ctx.edit.submitUploadFromBytes(mwn, bytes, partName, title, text, params);
		return finish(data);
	}

	let response: { upload: ApiUploadResponse };
	try {
		response = (await ctx.edit.submit(mwn, {
			action: 'upload',
			url,
			filename: title,
			text,
			ignorewarnings: true,
			...params,
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=upload response shape; trusted at this boundary
		})) as { upload: ApiUploadResponse };
	} catch (error) {
		if (errorMessage(error).includes('copyuploaddisabled')) {
			return ctx.format.error(
				'upstream_failure',
				`Could not retrieve the file from ${url}: the server could not reach it and the wiki has upload-by-URL disabled.`,
				'copyuploaddisabled',
			);
		}
		throw error;
	}
	return finish(response.upload);
}
