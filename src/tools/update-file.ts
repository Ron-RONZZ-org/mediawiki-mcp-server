import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ApiUploadParams } from 'types-mediawiki-api';
import type { ApiUploadResponse } from 'mwn';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import { assertAllowedPath, UploadValidationError } from '../transport/uploadGuard.ts';
import { readUploadBytes } from '../transport/uploadBytes.ts';
import { assertFileExists, FileNotFoundError } from '../transport/fileExistence.ts';
import { formatEditComment, buildPageUrl } from '../wikis/utils.ts';
import {
	hasImageFacts,
	imageFactsClearSchema,
	imageFactsSchema,
	submitImageFacts,
	wrapImageFactsFailure,
	type ImageFacts,
} from './imageFacts.ts';

const inputSchema = {
	filepath: z
		.string()
		.optional()
		.describe(
			'File path on the local disk. Required unless factsOnly=true; ignored when factsOnly=true.',
		),
	title: z.string().describe('File title (with or without the "File:" prefix)'),
	comment: z.string().optional().describe('Reason for uploading the new revision'),
	factsOnly: z
		.boolean()
		.optional()
		.describe(
			'Update only the semantic image facts on the existing File page. No bytes are uploaded and filepath is ignored; at least one fact field or clear entry is required.',
		),
	...imageFactsSchema,
	...imageFactsClearSchema,
} as const;

export const updateFile: Tool<typeof inputSchema> = {
	name: 'update-file',
	description:
		"Uploads a new revision of an existing file from the local disk, preserving prior revisions in the file history, and returns the file title and URL. The upload appears in the wiki's upload log. Replaces the file content (bytes) only; for editing the wikitext on a file's description page, use update-page. The operator restricts which directories are readable; filepath must be an absolute path inside a configured upload directory, or the call fails before contacting the wiki. Optional license, author, licenseInfo, sourceUrl and description replace those image-fact statements on the sitelinked item (mode=update; a blank field keeps the current value), and clear removes the named fields. Set factsOnly=true to update only the facts on the existing page without uploading bytes (filepath is then optional and ignored). Fails if no file exists at the target title; for the initial upload, use upload-file. To upload a new revision from a remote web address instead of a local path, use update-file-from-url.",
	inputSchema,
	annotations: {
		title: 'Update file',
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	failureVerb: 'update file',
	target: (a) => a.title,

	async handle(
		{
			filepath,
			title,
			comment,
			factsOnly,
			description,
			license,
			author,
			licenseInfo,
			sourceUrl,
			clear,
		},
		ctx: ToolContext,
	): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const ensureFileExists = async (): Promise<CallToolResult | null> => {
			try {
				await assertFileExists(mwn, title);
				return null;
			} catch (error) {
				if (error instanceof FileNotFoundError) {
					return ctx.format.notFound(
						`File "${error.title}" does not exist. To create a new file, use upload-file.`,
					);
				}
				throw error;
			}
		};
		const facts: ImageFacts = { description, license, author, licenseInfo, sourceUrl };

		if (factsOnly) {
			const notFound = await ensureFileExists();
			if (notFound) {
				return notFound;
			}
			if (!hasImageFacts(facts, clear)) {
				return ctx.format.invalidInput(
					'factsOnly requires at least one fact field or clear entry.',
				);
			}
			const filename = title.replace(/^File:/, '');
			let imageFacts: { itemId?: string; warning?: string };
			try {
				imageFacts = await submitImageFacts(ctx, mwn, `File:${filename}`, facts, {
					mode: 'update',
					clear,
				});
			} catch (error) {
				throw wrapImageFactsFailure(`File:${filename}`, error, false);
			}
			return ctx.format.ok({
				filename,
				pageUrl: await buildPageUrl(ctx, `File:${filename}`),
				...(imageFacts.itemId !== undefined ? { imageItemId: imageFacts.itemId } : {}),
				...(imageFacts.warning !== undefined ? { imageFactsWarning: imageFacts.warning } : {}),
				factsOnly: true,
			});
		}

		if (!filepath) {
			return ctx.format.invalidInput('filepath is required unless factsOnly=true.');
		}
		let resolvedPath: string;
		let bytes: Buffer;
		try {
			resolvedPath = await assertAllowedPath(filepath, ctx.uploadDirs.list());
			bytes = await readUploadBytes(resolvedPath);
		} catch (error) {
			if (error instanceof UploadValidationError) {
				return ctx.format.invalidInput(`Failed to update file: ${error.message}`);
			}
			throw error;
		}

		const notFound = await ensureFileExists();
		if (notFound) {
			return notFound;
		}

		const params: ApiUploadParams = {
			comment: formatEditComment(ctx, 'update-file', comment),
			ignorewarnings: true,
		};
		const data: ApiUploadResponse = await ctx.edit.submitUploadFromBytes(
			mwn,
			bytes,
			title.replace(/^File:/, ''),
			title,
			'',
			params,
		);

		const imageinfo = (
			data as ApiUploadResponse & {
				imageinfo?: { descriptionurl?: string; url?: string };
			}
		).imageinfo;
		const filename = data.filename ?? title.replace(/^File:/, '');
		let imageFacts: { itemId?: string; warning?: string };
		try {
			imageFacts = await submitImageFacts(ctx, mwn, `File:${filename}`, facts, {
				mode: 'update',
				clear,
			});
		} catch (error) {
			throw wrapImageFactsFailure(`File:${filename}`, error);
		}
		return ctx.format.ok({
			filename,
			pageUrl: imageinfo?.descriptionurl ?? (await buildPageUrl(ctx, `File:${filename}`)),
			...(imageinfo?.url !== undefined ? { fileUrl: imageinfo.url } : {}),
			...(imageFacts.itemId !== undefined ? { imageItemId: imageFacts.itemId } : {}),
			...(imageFacts.warning !== undefined ? { imageFactsWarning: imageFacts.warning } : {}),
		});
	},
};
