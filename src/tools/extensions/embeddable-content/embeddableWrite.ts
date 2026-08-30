import type { Mwn } from 'mwn';
import type { ToolContext } from '../../../runtime/context.ts';
import { formatEditComment } from '../../../wikis/utils.ts';

/** Item IDs the Add* flows accept in entity fields: Q42, not P42 or a name. */
export const ITEM_ID = /^[Qq]\d+$/;

/** A single lowercase MediaWiki language code, as MediaWiki writes them. */
export const LANGUAGE_CODE = /^[a-z][a-z0-9-]{1,19}$/;

/** Statement shape as the Wikibase action API reads it (formatversion 2). */
export interface StatementJson {
	mainsnak: {
		snaktype: 'value';
		property: string;
		datavalue: { type: string; value: unknown };
	};
	type: 'statement';
	rank: 'normal';
	/** The GUID; present on statements read from the wiki, absent on new ones. */
	id?: string;
}

export function entityStatement(property: string, itemId: string): StatementJson {
	return statement({
		snaktype: 'value',
		property,
		datavalue: {
			type: 'wikibase-entityid',
			value: { 'entity-type': 'item', id: itemId.toUpperCase() },
		},
	});
}

export function stringStatement(property: string, value: string): StatementJson {
	return statement({
		snaktype: 'value',
		property,
		datavalue: { type: 'string', value },
	});
}

export function monolingualStatement(
	property: string,
	text: string,
	language: string,
): StatementJson {
	return statement({
		snaktype: 'value',
		property,
		datavalue: { type: 'monolingualtext', value: { text, language } },
	});
}

/** A `YYYY-MM-DD` date at day precision, matching the Add* forms' `date` field. */
export function dayStatement(property: string, date: string): StatementJson {
	const [year, month, day] = date.split('-');
	return timeStatement(
		property,
		`+${year}-${month}-${day}T00:00:00Z`,
		11, // TimeValue::PRECISION_DAY
	);
}

/** A year at year precision, matching Special:AddSource's `issuedYear` field. */
export function yearStatement(property: string, year: number): StatementJson {
	return timeStatement(property, `+${String(year).padStart(4, '0')}-00-00T00:00:00Z`, 9);
}

function timeStatement(property: string, time: string, precision: number): StatementJson {
	return statement({
		snaktype: 'value',
		property,
		datavalue: {
			type: 'time',
			value: {
				time,
				timezone: 0,
				before: 0,
				after: 0,
				precision,
				calendarmodel: 'http://www.wikidata.org/entity/Q1985727',
			},
		},
	});
}

/** A whole-second quantity, as Special:AddSource stores durations. */
export function quantityStatement(property: string, amount: number): StatementJson {
	return statement({
		snaktype: 'value',
		property,
		datavalue: {
			type: 'quantity',
			value: { amount: `${amount >= 0 ? '+' : '-'}${Math.abs(amount)}`, unit: '1' },
		},
	});
}

function statement(mainsnak: StatementJson['mainsnak']): StatementJson {
	return { mainsnak, type: 'statement', rank: 'normal' };
}

/**
 * Splits a comma/semicolon-separated item-ID field. Returns null when any
 * element is not an item ID, mirroring the forms' strictness: a typo in one
 * id must never silently drop statements.
 */
export function splitItemIds(input: string | undefined): string[] | null {
	const trimmed = (input ?? '').trim();
	if (trimmed === '') {
		return [];
	}
	const ids: string[] = [];
	for (const candidate of trimmed.split(/[,;]/)) {
		const id = candidate.trim();
		if (!ITEM_ID.test(id)) {
			return null;
		}
		ids.push(id.toUpperCase());
	}
	return ids;
}

/** `MM:SS` or `HH:MM:SS` → seconds; null when the value is not a duration. */
export function parseDurationSeconds(input: string | undefined): number | null {
	const trimmed = (input ?? '').trim();
	if (trimmed === '') {
		return null;
	}
	const match = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(trimmed);
	if (match === null) {
		return null;
	}
	const hours = match[3] === undefined ? 0 : Number(match[1]);
	const minutes = match[3] === undefined ? Number(match[1]) : Number(match[2]);
	const seconds = match[3] === undefined ? Number(match[2]) : Number(match[3]);
	return hours * 3600 + minutes * 60 + seconds;
}

/** `YYYY` → year number; null when not a year. */
export function parseYear(input: string | undefined): number | null {
	const trimmed = (input ?? '').trim();
	return /^\d{4}$/.test(trimmed) ? Number(trimmed) : null;
}

/** `YYYY-MM-DD` → the same string; null when not a calendar date. */
export function parseDayDate(input: string | undefined): string | null {
	const trimmed = (input ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return null;
	}
	const date = new Date(`${trimmed}T00:00:00Z`);
	return Number.isNaN(date.getTime()) ? null : trimmed;
}

/** True for an http/https URL, the fragment sanitizer's contract. */
export function isHttpUrl(input: string): boolean {
	try {
		const url = new URL(input);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Strips one layer of math delimiters (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`),
 * matching the AddMath save step so pasted TeX stores as bare source.
 */
export function stripMathDelimiters(payload: string): string {
	const trimmed = payload.trim();
	for (const [open, close] of [
		['\\(', '\\)'],
		['\\[', '\\]'],
		['$$', '$$'],
		['$', '$'],
	] as const) {
		if (
			trimmed.length > open.length + close.length &&
			trimmed.startsWith(open) &&
			trimmed.endsWith(close)
		) {
			return trimmed.slice(open.length, -close.length).trim();
		}
	}
	return trimmed;
}

/**
 * Encodes a content payload for storage (the extension's escape-at-rest
 * scheme, issue #6 §8 option A): the wiki's string and monolingualtext
 * values reject vertical whitespace and tabs, so backslashes are escaped
 * first, then carriage returns, newlines and tabs become the literal
 * sequences `\r`, `\n`, `\t`. The wiki decodes at render time — the
 * embed renderers and the {{#content:Qxx}} decoder function. Mirrors
 * EmbeddableContent's PayloadCodec::escape.
 */
export function escapePayload(payload: string): string {
	return payload
		.replace(/\\/g, '\\\\')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t');
}

/** A `YYYY-MM-DD` day date is required for the form's `date` field. */
export const DAY_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An item ID as-is, or the item whose English label equals the value —
 * the autofill the entity comboboxes do on the forms.
 */
export async function resolveItemIdOrLabel(
	ctx: ToolContext,
	value: string,
): Promise<string | undefined> {
	const trimmed = value.trim();
	if (ITEM_ID.test(trimmed)) {
		return trimmed.toUpperCase();
	}
	const mwn: Mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbsearchentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbsearchentities',
		search: trimmed,
		language: 'en',
		type: 'item',
		limit: 10,
		format: 'json',
		formatversion: '2',
	})) as { search?: { id?: string; label?: string }[] };

	return response.search?.find((result) => result.label === trimmed)?.id;
}

interface EntityResponse {
	id?: string;
	type?: string;
	missing?: unknown;
	labels?: Record<string, { value?: string } | undefined>;
	descriptions?: Record<string, { value?: string } | undefined>;
	claims?: Record<string, StatementJson[]>;
}

export interface ExistingEntity {
	id: string;
	type?: string;
	labels?: Record<string, { value?: string } | undefined>;
	descriptions?: Record<string, { value?: string } | undefined>;
	claims: StatementJson[];
}

/** Reads one entity's terms and claims; undefined when it does not exist. */
export async function readEntity(mwn: Mwn, id: string): Promise<ExistingEntity | undefined> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbgetentities response shape; trusted at this boundary
	const response = (await mwn.request({
		action: 'wbgetentities',
		ids: id.toUpperCase(),
		props: 'labels|descriptions|claims',
		format: 'json',
		formatversion: '2',
	})) as { entities?: Record<string, EntityResponse> };

	const entity = response.entities?.[id.toUpperCase()];
	if (entity === undefined || entity.missing !== undefined) {
		return undefined;
	}
	return {
		id: entity.id ?? id.toUpperCase(),
		type: entity.type,
		labels: entity.labels,
		descriptions: entity.descriptions,
		claims: flattenClaims(entity.claims),
	};
}

function flattenClaims(claims: Record<string, StatementJson[]> | undefined): StatementJson[] {
	return claims === undefined
		? []
		: Object.values(claims).flatMap((statements) =>
				statements.filter((s) => s?.mainsnak?.property !== undefined),
			);
}

/**
 * The update-mode merge: statements on managed properties are replaced by
 * the additions when the field was provided; everything else is kept with
 * its GUID. A property the caller did not provide is left untouched, so a
 * blank field never clobbers an existing statement (the Update* flows'
 * no-clobber contract).
 */
export function mergeClaims(
	existing: readonly StatementJson[],
	managedProperties: ReadonlySet<string>,
	additions: readonly StatementJson[],
): StatementJson[] {
	const provided = new Set(additions.map((s) => s.mainsnak.property));
	const kept = existing.filter(
		(s) => !managedProperties.has(s.mainsnak.property) || !provided.has(s.mainsnak.property),
	);
	return [...kept, ...additions];
}

export interface SavedEntity {
	entityId: string;
	entityType?: string;
	latestRevisionId?: number;
}

/**
 * Submits a wbeditentity write (create or update) through the edit service,
 * which injects the CSRF token and change tags. Returns undefined when the
 * wiki accepted the request but returned no entity.
 */
interface WriteResponse {
	entity?: { id?: string; type?: string; lastrevid?: number };
}

export async function submitEntityWrite(
	ctx: ToolContext,
	params: Record<string, string>,
): Promise<SavedEntity | undefined> {
	const mwn = await ctx.mwn();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wbeditentity response shape; trusted at this boundary
	const response = (await ctx.edit.submit(mwn, {
		action: 'wbeditentity',
		...params,
	})) as WriteResponse | undefined;

	const entity = response?.entity;
	if (entity?.id === undefined) {
		return undefined;
	}
	return {
		entityId: entity.id,
		entityType: entity.type,
		latestRevisionId: entity.lastrevid,
	};
}

/** The edit summary with the tool attribution, when the wiki wants one. */
export function editSummary(
	ctx: ToolContext,
	toolName: string,
	comment?: string,
): string | undefined {
	return formatEditComment(ctx, toolName, comment);
}
