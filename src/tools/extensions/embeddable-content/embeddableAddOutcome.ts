import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../../runtime/context.ts';

/**
 * Outcome helpers shared by the EmbeddableContent add tools. Each wiki API
 * module (action=addsource, addsemanticentity, addspecialcontent) answers a
 * create the duplication guard refuses with
 * { duplicate: '1', duplicateOf, duplicateLabel, match } under its result
 * key — no entityId, no error. A response that carries neither an entity nor
 * that shape is a lost or partial answer (mwn throws on a real API error, so
 * a bare success means the module ran and the answer never arrived); these
 * helpers turn that answer into something a caller can act on before it
 * retries a write.
 */

export interface DuplicateHit {
	duplicateOf: string;
	duplicateLabel?: string;
	match?: string;
}

/**
 * Reads the duplication-guard answer from an entity-less module result. The
 * guard fires only on create and only when confirmDuplicate was not sent:
 * the item was NOT created, and duplicateOf names the existing item the
 * record collides with (an identical authority id / URL, or a highly similar
 * class-filtered label). Returns undefined when the result does not carry
 * the shape.
 */
export function duplicateHitOf(
	result:
		| {
				duplicate?: boolean | string;
				duplicateOf?: string;
				duplicateLabel?: string;
				match?: string;
		  }
		| undefined,
): DuplicateHit | undefined {
	if (
		result === undefined ||
		!(result.duplicate === true || result.duplicate === '1') ||
		result.duplicateOf === undefined ||
		result.duplicateOf === ''
	) {
		return undefined;
	}
	return {
		duplicateOf: result.duplicateOf,
		...(result.duplicateLabel !== undefined && result.duplicateLabel !== ''
			? { duplicateLabel: result.duplicateLabel }
			: {}),
		...(result.match !== undefined && result.match !== '' ? { match: result.match } : {}),
	};
}

/**
 * The result a guarded create gets: a success envelope (the wiki processed
 * the request) that says the item was not created and names the existing
 * item the guard matched. The caller decides whether that item IS the
 * intended one (cite or update it instead) or whether the create should be
 * forced past the guard with confirmDuplicate.
 */
export function duplicateHitResult(ctx: ToolContext, hit: DuplicateHit): CallToolResult {
	return ctx.format.ok({
		notCreated: 'duplicate',
		duplicateOf: hit.duplicateOf,
		...(hit.duplicateLabel !== undefined ? { duplicateLabel: hit.duplicateLabel } : {}),
		...(hit.match !== undefined ? { match: hit.match } : {}),
		note: 'Create refused by the wiki\u2019s duplication guard \u2014 the record matches an existing item. Cite or update that item (duplicateOf), or set confirmDuplicate=true to create this one anyway.',
	});
}

export interface UnresolvedWriteOptions {
	/** What the call asked to create, for the message: 'citation source', 'semantic entity', 'content item'. */
	noun: string;
	/** create when no qid was sent, update when one was. */
	mode: 'create' | 'update';
	/**
	 * The label text the create would have stored, when the tool can predict
	 * it (the title, the label argument, or the name derived from
	 * given/family). Enables a term-store check that tells a create apart
	 * from a no-op before the caller retries. Omit when the stored label is
	 * not derivable from the arguments.
	 */
	label?: string;
	/** The update target, for the message. */
	qid?: string;
	/** Language the create stored its label in; defaults to en. */
	labelLanguage?: string;
}

/**
 * Renders the outcome of a write whose response carried no result and no
 * error. For a create whose stored label is predictable, asks the term store
 * whether the item now exists and answers "likely landed" or "did not land,
 * retry is safe" from that. Where no label is predictable, the message says
 * the outcome is unknown and points at the search tools that resolve it. An
 * update leaves no outside signal to check, so the message states that
 * re-running it produces the same statements.
 */
export async function unresolvedWriteResult(
	ctx: ToolContext,
	options: UnresolvedWriteOptions,
): Promise<CallToolResult> {
	if (options.mode === 'create') {
		const label = options.label?.trim();
		if (label !== undefined && label !== '') {
			const found = await findItemByLabelPrefix(ctx, label, options.labelLanguage ?? 'en');
			if (found !== undefined) {
				return ctx.format.ok({
					outcome: 'likely-created',
					entityId: found.id,
					label: found.label,
					note: 'The wiki\u2019s response carried no result and no error code, but an item whose label starts with the submitted text exists \u2014 the create likely landed. Read it with wikibase-get-entity before creating again.',
				});
			}
			return ctx.format.error(
				'upstream_failure',
				`The wiki's response to the request to add a ${options.noun} carried no result and no error code, and a term-store search finds no item whose label starts with "${label}" \u2014 the ${options.noun} was not created, so retrying the call is safe.`,
			);
		}
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the request to add a ${options.noun} carried no result and no error code, so the create may or may not have landed. Check wikibase-search-entities (mode=contains) for the submitted title or name before retrying \u2014 a blind retry can create a second item when the wiki's duplication guard cannot run.`,
		);
	}
	const target = options.qid === undefined ? '' : ` of ${options.qid}`;
	return ctx.format.error(
		'upstream_failure',
		`The wiki's response to the update${target} carried no result and no error code, so the update may or may not have been saved. Re-running this update produces the same statements \u2014 the fields you provide are replaced with the same values, and blank fields keep the current statements.`,
	);
}

interface LabelSearchHit {
	id: string;
	label: string;
}

/**
 * Asks the term store whether an item whose label starts with the given text
 * exists: a wbsearchentities prefix search in the given language. The store
 * is case-sensitive and a stored label begins with the exact text the create
 * submitted (class-suffixed labels such as "The Hobbit (Book)" included), so
 * an exact-case prefix hit is strong evidence the create landed. Returns the
 * first matching item, or undefined when none exists.
 */
export async function findItemByLabelPrefix(
	ctx: ToolContext,
	labelPrefix: string,
	language: string,
): Promise<LabelSearchHit | undefined> {
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsearchentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbsearchentities',
		search: labelPrefix,
		language,
		uselang: language,
		type: 'item',
		limit: 10,
		format: 'json',
		formatversion: '2',
	})) as { search?: { id?: string; label?: string }[] } | undefined;

	const hit = (response?.search ?? []).find(
		(match) =>
			typeof match.id === 'string' &&
			typeof match.label === 'string' &&
			(match.label === labelPrefix || match.label.startsWith(`${labelPrefix} (`)),
	);
	return hit !== undefined && hit.id !== undefined && hit.label !== undefined
		? { id: hit.id, label: hit.label }
		: undefined;
}
