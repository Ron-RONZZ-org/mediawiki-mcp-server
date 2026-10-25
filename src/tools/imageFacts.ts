import { z } from 'zod';
import type { Mwn } from 'mwn';
import type { ToolContext } from '../runtime/context.ts';
import { errorMessage } from '../errors/errorMessage.ts';
import { isErrnoException } from '../errors/isErrnoException.ts';

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
		.describe(
			'URL where the original file was found (external provenance: web page, repository, or File page). Omit for work you created yourself — the File: page is the origin.',
		),
} as const;

export type ImageFactsClearField = 'license' | 'author' | 'licenseInfo' | 'sourceUrl';

/** Explicit clear list for the update tools (mode=update only). */
export const imageFactsClearSchema = {
	clear: z
		.array(z.enum(['license', 'author', 'licenseInfo', 'sourceUrl']))
		.optional()
		.describe(
			'Fact fields to remove from the image item (mode=update only). A field cannot be both cleared and given a value.',
		),
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

export interface ImageFactsOptions {
	/** 'update' replaces the statements for each provided field (update-file). */
	mode?: 'create' | 'update';
	/** Fields to remove; requires mode=update. */
	clear?: ImageFactsClearField[];
}

/**
 * Wraps a post-upload facts failure with the upload outcome, keeping the
 * wiki error code so the dispatcher still classifies permission/input errors
 * as such instead of a generic upstream failure.
 */
export function wrapImageFactsFailure(filePage: string, error: unknown, uploaded = true): Error {
	const message = uploaded
		? `The file was uploaded as ${filePage}, but attaching image facts failed: ${errorMessage(error)}`
		: `Updating image facts for ${filePage} failed: ${errorMessage(error)}`;
	const wrapped = new Error(message) as Error & { code?: string };
	if (isErrnoException(error) && error.code !== undefined) {
		wrapped.code = error.code;
	}
	return wrapped;
}

export function hasImageFacts(facts: ImageFacts, clear?: ImageFactsClearField[]): boolean {
	return (
		(clear?.length ?? 0) > 0 ||
		Object.values(facts).some((value) => typeof value === 'string' && value.trim() !== '')
	);
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
	options: ImageFactsOptions = {},
): Promise<ImageFactsResult> {
	if (!hasImageFacts(facts, options.clear)) {
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
			...(options.mode !== undefined ? { mode: options.mode } : {}),
			...(options.clear !== undefined && options.clear.length > 0
				? { clear: options.clear.join(',') }
				: {}),
		})) as { imagefacts?: { itemId?: unknown } };

		const itemId = response?.imagefacts?.itemId;
		if (typeof itemId === 'string' && itemId !== '') {
			return { itemId };
		}
		return {
			warning: 'The wiki accepted the image facts but returned no item id.',
		};
	} catch (error) {
		const message = errorMessage(error);
		if (isMissingAction(error, message)) {
			return {
				warning:
					'This wiki has no image-facts API (EmbeddableContent action=imagefacts); the semantic license/author facts were not written.',
			};
		}
		throw error;
	}
}

/**
 * Runs the facts step after a successful upload and returns the fields to add
 * to the upload response. An upload that succeeded must not be reported as a
 * failed call because the facts step did, so every failure is wrapped with the
 * upload outcome; `hasImageFacts` keeps a plain upload free of the extra call.
 */
export async function attachImageFacts(
	ctx: ToolContext,
	mwn: Mwn,
	title: string,
	facts: ImageFacts,
	options: ImageFactsOptions = {},
	uploaded = true,
): Promise<Record<string, unknown>> {
	if (!hasImageFacts(facts, options.clear)) {
		return {};
	}
	try {
		const result = await submitImageFacts(ctx, mwn, title, facts, options);
		return {
			...(result.itemId !== undefined ? { imageItemId: result.itemId } : {}),
			...(result.warning !== undefined ? { imageFactsWarning: result.warning } : {}),
		};
	} catch (error) {
		throw wrapImageFactsFailure(title, error, uploaded);
	}
}
