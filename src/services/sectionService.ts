import type { Mwn } from 'mwn';

export interface SectionEntry {
	/** MediaWiki's own section id, as sent to `section=`. Non-numeric when transcluded. */
	index: string;
	/** Heading depth as an `=` count, 2..6, from the API's `level`. */
	level: number;
	/** Heading text. */
	line: string;
	/** False when the section is transcluded and cannot be edited on this page. */
	editable: boolean;
	/**
	 * Byte offset of the heading in the parsed text, when the API reports it.
	 * A section replace must begin at this heading, so the offset tells the
	 * guard whether anything precedes it in the source.
	 */
	byteOffset?: number;
}

export interface SectionService {
	list(mwn: Mwn, title: string, revisionId?: number): Promise<SectionEntry[]>;
	listInSource(mwn: Mwn, title: string, source: string): Promise<SectionEntry[]>;
}

interface PageSectionsApi {
	index?: string;
	level?: string;
	line?: string;
	byteoffset?: string;
}

// The API reports `index` as `T-1`, `T-2`, … for sections that arrive by
// transclusion. Those cannot be edited on the host page, and their presence
// shifts every later entry's position away from its section number.
function isEditableIndex(index: string): boolean {
	return /^[1-9]\d*$/.test(index);
}

export class SectionServiceImpl implements SectionService {
	// `revisionId` asks for the outline as that revision had it. A write scoped
	// to a section resolves the number against the revision it names, so a guard
	// reading the current outline would judge a different section than the one
	// the write will replace.
	public async list(mwn: Mwn, title: string, revisionId?: number): Promise<SectionEntry[]> {
		return this.parseSections(mwn, {
			action: 'parse',
			...(revisionId === undefined ? { page: title } : { oldid: String(revisionId) }),
			prop: 'sections',
			formatversion: '2',
		});
	}

	// Parses `source` the way the wiki itself will when an edit lands, so the
	// sections found here agree with the outline `list` reports for the page —
	// one parser decides what counts as a heading on both sides. `title` gives
	// templates in the source their page context.
	public async listInSource(mwn: Mwn, title: string, source: string): Promise<SectionEntry[]> {
		return this.parseSections(mwn, {
			action: 'parse',
			text: source,
			title,
			contentmodel: 'wikitext',
			prop: 'sections',
			formatversion: '2',
		});
	}

	private async parseSections(mwn: Mwn, params: Record<string, string>): Promise<SectionEntry[]> {
		const response =
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mwn API response shape; trusted at this boundary
			(await mwn.request(params)) as { parse?: { sections?: PageSectionsApi[] } } | undefined;
		return (response?.parse?.sections ?? []).map((s) => {
			const index = s.index ?? '';
			const byteOffset = Number.parseInt(s.byteoffset ?? '', 10);
			return {
				index,
				level: Number.parseInt(s.level ?? '', 10) || 0,
				line: s.line ?? '',
				editable: isEditableIndex(index),
				...(Number.isNaN(byteOffset) ? {} : { byteOffset }),
			};
		});
	}
}

// The published outline: one line per section, each labelled with the number
// that edits it. Transcluded headings are left out — they appear on the page but
// no `section=` value addresses them, so listing them shifts every later heading
// away from its own number. Kept separate from the service so the richer entries
// stay available internally to the guards and markers that need levels.
export function toOutlineLines(entries: readonly SectionEntry[], totalBytes?: number): string[] {
	const offsets = entries
		.map((e) => e.byteOffset)
		.filter((o): o is number => o !== undefined)
		.sort((a, b) => a - b);
	const sizeOf = (e: SectionEntry): number | undefined => {
		if (totalBytes === undefined || e.byteOffset === undefined) {
			return undefined;
		}
		const next = offsets.find((o) => o > e.byteOffset!);
		const size = (next ?? totalBytes) - e.byteOffset;
		return size > 0 ? size : undefined;
	};
	const leadEnd = offsets[0];
	const lead =
		totalBytes !== undefined && leadEnd !== undefined && leadEnd > 0
			? `0 (Lead) — ${formatBytes(leadEnd)}`
			: '0 (Lead)';
	return [
		lead,
		...entries
			.filter((e) => e.editable)
			.map((e) => {
				const size = sizeOf(e);
				return `${e.index} (${e.line})${size === undefined ? '' : ` — ${formatBytes(size)}`}`;
			}),
	];
}

function formatBytes(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

export type SectionResolution = { readonly number: number } | { readonly error: string };

/**
 * Resolves a heading name (or a numeric string) to the section number the
 * wiki's `section=` parameter addresses. Exact match first, then
 * case-insensitive; a name that matches several sections is refused with the
 * candidate numbers rather than guessing.
 */
export function resolveSectionName(
	section: string,
	entries: readonly SectionEntry[],
): SectionResolution {
	const trimmed = section.trim();
	if (/^\d+$/.test(trimmed)) {
		return { number: Number.parseInt(trimmed, 10) };
	}
	if (trimmed.toLowerCase() === 'lead') {
		return { number: 0 };
	}
	const editable = entries.filter((e) => e.editable);
	const exact = editable.filter((e) => e.line === trimmed);
	const matches =
		exact.length > 0
			? exact
			: editable.filter((e) => e.line.toLowerCase() === trimmed.toLowerCase());
	if (matches.length === 1) {
		return { number: Number.parseInt(matches[0].index, 10) };
	}
	if (matches.length > 1) {
		const options = matches.map((e) => `${e.index} (${e.line})`).join(', ');
		return {
			error: `Section name "${section}" matches ${matches.length} sections: ${options}. Pass the section number instead.`,
		};
	}
	const available = editable
		.slice(0, 15)
		.map((e) => `${e.index} (${e.line})`)
		.join('; ');
	return {
		error:
			`No section named "${section}".` +
			(available ? ` Available: ${available}${editable.length > 15 ? '; …' : ''}.` : ''),
	};
}
