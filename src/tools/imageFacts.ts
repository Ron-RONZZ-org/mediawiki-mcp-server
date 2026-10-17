import { z } from 'zod';
import type { Mwn } from 'mwn';
import type { ToolContext } from '../runtime/context.ts';
import { errorMessage, isErrnoException } from '../errors/isErrnoException.ts';

/**
 * Optional semantic image facts an upload can carry. On wikis running the
 * ronzz-wikibase EmbeddableContent extension these become the sitelinked
 * image item's statements (license, image author, additional license
 * information, source URL) — the same facts Special:Upload writes for form
 * uploads. Other wikis answer `badvalue` for the action and the upload
 * still succeeds with a warning.
 */
export const imageFactsSchema = {
	description: z
		.string()
		.max(2000)
		.optional()
		.describe('Description stored on the image item (the File: page prose stays in text).'),
	license: z
		.string()
		.regex(/^Q[1-9]\d*$/)
		.optional()
		.describe(
			'License item ID (Q<n>), e.g. the instance license item for CC BY-SA 4.0. Resolve a license label to its Q-id first.',
		),
	author: z
		.string()
		.max(250)
		.optional()
		.describe('Image author, free text (the image author statement).'),
	licenseInfo: z
		.string()
		.max(250)
		.optional()
		.describe('Additional license information, free text (attribution, terms, credits).'),
	sourceUrl: z
		.string()
		.url()
		.optional()
		.describe('Source URL of the original file (provenance statement).'),
} as const;

export interface ImageFacts {
	description?: string;
	license?: string;
	author?: string;
	licenseInfo?: string;
	sourceUrl?: string;
}

export interface ImageFactsResult {
	itemId?: string;
	warning?: string;
}

/**
 * Wraps a post-upload facts failure with the upload outcome, keeping the
 * wiki error code so the dispatcher still classifies permission/input errors
 * as such instead of a generic upstream failure.
 */
export function wrapImageFactsFailure(filePage: string, error: unknown): Error {
	const wrapped = new Error(
		`The file was uploaded as ${filePage}, but attaching image facts failed: ${errorMessage(error)}`,
	) as Error & { code?: string };
	if (isErrnoException(error) && error.code !== undefined) {
		wrapped.code = error.code;
	}
	return wrapped;
}

function hasImageFacts(facts: ImageFacts): boolean {
	return Object.values(facts).some((value) => typeof value === 'string' && value.trim() !== '');
}

function isMissingAction(error: unknown, message: string): boolean {
	return (
		isErrnoException(error) &&
		error.code === 'badvalue' &&
		/parameter\s+"action".*imagefacts/i.test(message)
	);
}

/**
 * Calls the wiki's action=imagefacts for an uploaded File: page. Returns the
 * created/reused item id, or a warning when the wiki does not implement the
 * action. Every other failure is rethrown: the caller has already uploaded
 * the file and must report the partial success explicitly.
 */
export async function submitImageFacts(
	ctx: ToolContext,
	mwn: Mwn,
	title: string,
	facts: ImageFacts,
): Promise<ImageFactsResult> {
	if (!hasImageFacts(facts)) {
		return {};
	}
	try {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=imagefacts response shape; trusted at this boundary
		const response = (await ctx.edit.submit(mwn, {
			action: 'imagefacts',
			filename: title,
			...(facts.description?.trim() ? { description: facts.description.trim() } : {}),
			...(facts.license?.trim() ? { license: facts.license.trim() } : {}),
			...(facts.author?.trim() ? { author: facts.author.trim() } : {}),
			...(facts.licenseInfo?.trim() ? { licenseInfo: facts.licenseInfo.trim() } : {}),
			...(facts.sourceUrl?.trim() ? { sourceUrl: facts.sourceUrl.trim() } : {}),
		})) as { imagefacts?: { itemId?: unknown } };

		const itemId = response?.imagefacts?.itemId;
		if (typeof itemId === 'string' && itemId !== '') {
			return { itemId };
		}
		return {
			warning:
				'The wiki accepted the image facts but returned no item id; the file itself was uploaded successfully.',
		};
	} catch (error) {
		const message = errorMessage(error);
		if (isMissingAction(error, message)) {
			return {
				warning:
					'This wiki has no image-facts API (EmbeddableContent action=imagefacts); the file was uploaded without semantic license/author facts.',
			};
		}
		throw error;
	}
}
