import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../runtime/tool.ts';
import type { ToolContext } from '../runtime/context.ts';
import { truncateByBytes } from '../results/truncation.ts';

interface SourceFileTextPayload {
	file?: string;
	extractedFrom?: string;
	text?: string;
	chars?: number;
	updated?: string;
	partial?: string;
}

interface SourceFileTextResponse {
	sourcefiletext?: SourceFileTextPayload;
}

const inputSchema = {
	title: z.string().describe('File title of the PDF (with or without the "File:" prefix)'),
} as const;

export const getFileText: Tool<typeof inputSchema> = {
	name: 'get-file-text',
	description:
		"Returns the wiki's precomputed Markdown text of a PDF File page (Apache Tika text extraction with OCR where the PDF has no text layer). Use this for reading a PDF's content instead of downloading the file and parsing/OCRing it: it is much faster, handles scanned PDFs, and works for internal-use files (the wiki enforces the same login gate as the source file). The result includes the character count, extraction timestamp and a partial flag. If the wiki has no extraction yet, the tool returns an error — an operator can run the wiki's maintenance/extractPdfText.php backfill. The File: prefix is added automatically if omitted.",
	inputSchema,
	annotations: {
		title: 'Get extracted PDF text',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	failureVerb: 'fetch the extracted PDF text',
	target: (a) => a.title,

	async handle({ title }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const fileTitle = title.startsWith('File:') ? title : `File:${title}`;

		let response: SourceFileTextResponse;
		try {
			response = (await mwn.request({
				action: 'sourcefiletext',
				file: fileTitle,
				format: 'json',
			})) as SourceFileTextResponse;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return ctx.format.notFound(message);
		}

		const payload = response.sourcefiletext;
		if (!payload || typeof payload.text !== 'string') {
			return ctx.format.notFound(
				`No extracted text is available for "${fileTitle}". An operator can run the wiki's maintenance/extractPdfText.php backfill.`,
			);
		}

		const truncated = truncateByBytes(payload.text);
		return ctx.format.ok({
			file: payload.file ?? fileTitle,
			extractedFrom: payload.extractedFrom ?? '',
			chars: payload.chars ?? payload.text.length,
			updated: payload.updated ?? '',
			partial: payload.partial === '1',
			text: truncated.text,
			truncated: truncated.truncated,
			totalBytes: truncated.totalBytes,
		});
	},
};
