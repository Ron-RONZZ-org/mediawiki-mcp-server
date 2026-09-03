import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ToolContext } from '../../../runtime/context.ts';

/**
 * Lost-response outcomes for the Wikibase write tools (wbeditentity,
 * wbcreateclaim, wbsetsitelink). mwn throws on a real API error, so a
 * response that carries no entity / claim means the module ran and its
 * answer was lost mid-flight; these helpers re-read the wiki and turn the
 * ambiguity into a verdict the caller can act on before it retries.
 *
 * The verdicts differ from the EmbeddableContent add tools in one
 * important way: wbeditentity has NO duplication guard, so a lost CREATE
 * is never declared retry-safe on a negative search — a blind retry could
 * create a second entity. Only the positive direction (the entity exists)
 * is asserted; a negative answer points at the search tools instead.
 */

/** One entity as wbgetentities returns it under formatversion 2. */
export interface EntityRecord {
	id?: string;
	type?: string;
	lastrevid?: number;
	missing?: unknown;
	labels?: Record<string, { language?: string; value?: string } | undefined>;
	descriptions?: Record<string, { language?: string; value?: string } | undefined>;
	claims?: Record<string, ClaimRecord[]>;
	sitelinks?: Record<string, { site?: string; title?: string } | undefined>;
}

export interface ClaimRecord {
	id?: string;
	mainsnak?: {
		snaktype?: string;
		property?: string;
		datavalue?: { type?: string; value?: unknown };
	};
}

/** A term map as wbeditentity data carries it: { en: { language, value } }. */
interface TermMap {
	[lang: string]: { value?: string } | undefined;
}

/**
 * wbgetentities for one id with the requested props, or undefined when the
 * wiki answers nothing usable (no entity, or the entity is missing). A
 * transport or API error from mwn propagates to the dispatcher.
 */
export async function readEntity(
	ctx: ToolContext,
	id: string,
	props: string,
): Promise<EntityRecord | undefined> {
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbgetentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbgetentities',
		ids: id.toUpperCase(),
		props,
		format: 'json',
		formatversion: '2',
	})) as { entities?: Record<string, EntityRecord> } | undefined;

	const entity = response?.entities?.[id.toUpperCase()];
	return entity === undefined || entity.missing !== undefined ? undefined : entity;
}

/**
 * Asks the term store whether an item whose label starts with the given text
 * exists: a wbsearchentities prefix search in the given language. The store
 * is case-sensitive, so an exact-case prefix hit is strong evidence the
 * entity exists with that label. Returns the first matching item, or
 * undefined when none exists.
 */
export async function findItemByLabelPrefix(
	ctx: ToolContext,
	labelPrefix: string,
	language: string,
): Promise<{ id: string; label: string } | undefined> {
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

/**
 * Whether a claim's mainsnak holds the value wikibase-add-statement sent for
 * its datatype: an item value compares by entity id, a string / external-id /
 * url value compares by literal text.
 */
export function claimHasValue(claim: ClaimRecord, datatype: string, value: string): boolean {
	const mainsnak = claim.mainsnak;
	if (mainsnak?.snaktype !== 'value' || mainsnak.datavalue === undefined) {
		return false;
	}
	const { type, value: dataValue } = mainsnak.datavalue;
	if (datatype === 'wikibase-item') {
		if (type !== 'wikibase-entityid' || typeof dataValue !== 'object' || dataValue === null) {
			return false;
		}
		const entityValue = dataValue as { id?: unknown };
		return typeof entityValue.id === 'string' && entityValue.id === value.toUpperCase();
	}
	return typeof dataValue === 'string' && dataValue === value;
}

/**
 * Whether an item's sitelinks already carry the page title on the site. Both
 * sides are compared with underscores normalised to spaces, as MediaWiki
 * stores titles.
 */
export function sitelinksContain(
	sitelinks: EntityRecord['sitelinks'],
	site: string,
	page: string,
): boolean {
	const title = sitelinks?.[site]?.title;
	if (title === undefined) {
		return false;
	}
	return title.replaceAll('_', ' ') === page.replaceAll('_', ' ');
}

/**
 * The result for a set-sitelink write whose response was lost: re-read the
 * item's sitelinks (and last revision) and report whether the link landed.
 * present mirrors the success payload; absent is a definitive not-set (the
 * read is authoritative), so retrying is safe. When the read answers
 * nothing usable, the caller is told to check with wikibase-get-entity.
 */
export async function lostSetSitelinkResult(
	ctx: ToolContext,
	options: { qid: string; site: string; page: string },
): Promise<CallToolResult> {
	const entity = await readEntity(ctx, options.qid, 'info|sitelinks');
	if (entity === undefined) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the set-sitelink request carried no result and no error code, so the link may or may not have been set. Re-running the call is harmless — the same sitelink replaces the old one — but read ${options.qid} with wikibase-get-entity first to avoid a needless revision.`,
		);
	}
	if (sitelinksContain(entity.sitelinks, options.site, options.page)) {
		return ctx.format.ok({
			entityId: options.qid,
			...(typeof entity.lastrevid === 'number' ? { latestRevisionId: entity.lastrevid } : {}),
			sitelinkSite: options.site,
			page: options.page,
		});
	}
	return ctx.format.error(
		'upstream_failure',
		`The wiki's response to the set-sitelink request carried no result and no error code, and ${options.qid}'s sitelinks do not link "${options.page}" on ${options.site} — the link was not set, so retrying the call is safe.`,
	);
}

/**
 * The result for an add-statement write whose response was lost: re-read the
 * entity's claims for the property and report whether a claim with the sent
 * value exists. present mirrors the success payload with the matched claim
 * id; absent is definitive (the read is authoritative), so retrying is safe.
 * When the read answers nothing usable, the caller is warned that adding the
 * same value twice leaves two identical statements.
 */
export async function lostAddStatementResult(
	ctx: ToolContext,
	options: { entity: string; property: string; datatype: string; value: string },
): Promise<CallToolResult> {
	const entity = await readEntity(ctx, options.entity, 'info|claims');
	const matched =
		entity?.claims?.[options.property]?.find((claim) =>
			claimHasValue(claim, options.datatype, options.value),
		) ?? undefined;
	if (entity === undefined) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the add-statement request carried no result and no error code, so the statement may or may not have been added. Read ${options.entity} with wikibase-get-entity before retrying — adding the same value a second time leaves the entity holding two identical statements.`,
		);
	}
	if (matched?.id !== undefined) {
		return ctx.format.ok({
			entityId: options.entity,
			propertyId: options.property,
			statementId: matched.id,
			...(typeof entity.lastrevid === 'number' ? { latestRevisionId: entity.lastrevid } : {}),
		});
	}
	const display =
		options.datatype === 'wikibase-item' ? options.value.toUpperCase() : `"${options.value}"`;
	return ctx.format.error(
		'upstream_failure',
		`The wiki's response to the add-statement request carried no result and no error code, and ${options.entity} holds no ${options.property} claim with value ${display} — the statement was not added, so retrying the call is safe.`,
	);
}

/**
 * The result for an entity-create write whose response was lost. There is no
 * duplication guard on wbeditentity, so only the positive direction is
 * asserted: an item whose label starts with the submitted label is found →
 * likely-created (do not re-run). A negative or unverifiable answer tells
 * the caller to search before retrying — never that retrying is safe.
 */
export async function lostEditEntityCreateResult(
	ctx: ToolContext,
	options: { entityType: string; labels: TermMap | undefined },
): Promise<CallToolResult> {
	// Labels seed the term-store check; descriptions and aliases are not
	// searchable there, and an entity created without labels cannot be
	// recognised from outside.
	const labelTerm = pickLabelTerm(options.labels);
	if (labelTerm === undefined) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the request to create a ${options.entityType} carried no result and no error code, so it may or may not have been created. Search wikibase-search-entities for the submitted labels before retrying — a blind retry can create a second entity, since creating has no duplication guard.`,
		);
	}
	const found = await findItemByLabelPrefix(ctx, labelTerm.value, labelTerm.language);
	if (found !== undefined) {
		return ctx.format.ok({
			outcome: 'likely-created',
			entityId: found.id,
			label: found.label,
			note: 'The wiki\u2019s response carried no result and no error code, but an item whose label starts with the submitted label exists \u2014 the create likely landed. Read it with wikibase-get-entity before deciding whether to retry.',
		});
	}
	return ctx.format.error(
		'upstream_failure',
		`The wiki's response to the request to create a ${options.entityType} carried no result and no error code, and a term-store search finds no item whose ${labelTerm.language} label starts with "${labelTerm.value}" — but absence is not proof the create failed, since the term store is case-sensitive and no duplication guard protects a retry. Search wikibase-search-entities (mode=contains where the wiki has a query service) for the submitted labels before retrying.`,
	);
}

/**
 * The result for an entity-update write whose response was lost. A term-only
 * update (labels/descriptions, no claims, no sitelinks, no clear) is checked
 * against the entity's current terms: the update's outcome is atomic, so when
 * every submitted term now matches, the final state holds (the ok payload
 * mirrors success); when one differs, the update did not land and retrying is
 * safe. A read that answers nothing usable says re-running a term-only update
 * is safe. Updates carrying claims or sitelinks, and clear=true replacements,
 * get their own guidance.
 */
export async function lostEditEntityUpdateResult(
	ctx: ToolContext,
	options: {
		qid: string;
		clear: boolean;
		labels: TermMap | undefined;
		descriptions: TermMap | undefined;
		hasClaims: boolean;
		hasSitelinks: boolean;
	},
): Promise<CallToolResult> {
	if (options.clear) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the update of ${options.qid} carried no result and no error code, so the update may or may not have been saved. Re-running it is safe: clear=true replaces the entity with exactly the data, so the second run reaches the same final state whether or not the first landed.`,
		);
	}
	if (options.hasClaims || options.hasSitelinks) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the update of ${options.qid} carried no result and no error code, so the update may or may not have been saved. Read ${options.qid} with wikibase-get-entity to see which changes are present, then re-run only the absent parts — a blind re-run of a landed update adds GUID-less statements a second time.`,
		);
	}

	const checks = collectTermChecks(options.labels, options.descriptions);
	if (checks.length === 0) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the update of ${options.qid} carried no result and no error code, so the update may or may not have been saved. Read ${options.qid} with wikibase-get-entity to confirm; re-running the same terms is safe (terms for the languages you provide are replaced with the same values).`,
		);
	}

	const entity = await readEntity(ctx, options.qid, 'info|labels|descriptions');
	if (entity === undefined) {
		return ctx.format.error(
			'upstream_failure',
			`The wiki's response to the update of ${options.qid} carried no result and no error code, so the update may or may not have been saved. Re-running the same terms is safe — terms for the languages you provide are replaced with the same values — but read ${options.qid} with wikibase-get-entity if you want certainty.`,
		);
	}

	if (checks.every(({ kind, language, value }) => termHolds(entity, kind, language, value))) {
		return ctx.format.ok({
			entityId: options.qid,
			...(typeof entity.type === 'string' ? { entityType: entity.type } : {}),
			...(typeof entity.lastrevid === 'number' ? { latestRevisionId: entity.lastrevid } : {}),
		});
	}
	return ctx.format.error(
		'upstream_failure',
		`The wiki's response to the update of ${options.qid} carried no result and no error code, and the entity's terms do not match the submitted data — the update did not land, so retrying the call is safe.`,
	);
}

/** The label term that seeds a create's term-store check: en first, else the first. */
function pickLabelTerm(
	labels: TermMap | undefined,
): { language: string; value: string } | undefined {
	if (labels === undefined) {
		return undefined;
	}
	const languages = Object.keys(labels).sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : 0));
	for (const language of languages) {
		const value = labels[language]?.value?.trim();
		if (value !== undefined && value !== '') {
			return { language, value };
		}
	}
	return undefined;
}

interface TermCheck {
	kind: 'label' | 'description';
	language: string;
	value: string;
}

/** The non-empty label/description terms a term-only update would set. */
function collectTermChecks(
	labels: TermMap | undefined,
	descriptions: TermMap | undefined,
): TermCheck[] {
	const checks: TermCheck[] = [];
	for (const language of Object.keys(labels ?? {})) {
		const value = labels?.[language]?.value;
		if (value !== undefined && value !== '') {
			checks.push({ kind: 'label', language, value });
		}
	}
	for (const language of Object.keys(descriptions ?? {})) {
		const value = descriptions?.[language]?.value;
		if (value !== undefined && value !== '') {
			checks.push({ kind: 'description', language, value });
		}
	}
	return checks;
}

function termHolds(
	entity: EntityRecord,
	kind: 'label' | 'description',
	language: string,
	value: string,
): boolean {
	if (kind === 'label') {
		return entity.labels?.[language]?.value === value;
	}
	return entity.descriptions?.[language]?.value === value;
}
