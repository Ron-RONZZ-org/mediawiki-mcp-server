import { readFile, stat } from 'node:fs/promises';
import { UploadValidationError } from './uploadGuard.ts';
import { resolveUploadMaxBytes } from './httpFetch.ts';

/**
 * Reads an upload source into memory under the operator's upload cap.
 *
 * Uploads must be sent as bytes rather than a file stream: mwn retries a failed
 * request (badtoken / assertuserfailed / transient network error) by re-sending
 * the same params, and a consumed ReadStream makes that retry declare the full
 * Content-Length while sending an empty body — the request then hangs until the
 * HTTP timeout. A Buffer is replayable across retries.
 */
export async function readUploadBytes(filepath: string): Promise<Buffer> {
	const limit = resolveUploadMaxBytes();
	const { size } = await stat(filepath);
	if (size > limit) {
		throw new UploadValidationError(
			`file is ${size} bytes, over the ${limit}-byte upload limit (MCP_UPLOAD_MAX_BYTES).`,
		);
	}
	return readFile(filepath);
}
