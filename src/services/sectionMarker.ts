import type { TruncationInfo } from '../results/truncation.ts';
import { toOutlineLines, type SectionEntry } from './sectionService.ts';
import { editableChildrenOf } from './sectionSubtree.ts';

/**
 * The `content-truncated` marker for a tool that reads page content, where what
 * the caller can do about a cut body depends on what it asked for.
 *
 * A whole-page read still has sections to narrow to. A section read has already
 * spent that narrowing, so its own subsections are the only narrower target, and
 * where it has none the convention is to say no action remains rather than to
 * name the call that just truncated.
 *
 * Shared by every section-aware read, so the three variants and their wording
 * are decided once. Tools whose content is not sections — a diff, a rendered
 * fragment, a row listing — carry their own remedy, which is theirs alone and
 * belongs with them.
 */
export function sectionContentTruncation({
	entries,
	section,
	itemNoun,
	toolName,
	returnedBytes,
	totalBytes,
}: {
	readonly entries: readonly SectionEntry[];
	readonly section: number | undefined;
	readonly itemNoun: string;
	readonly toolName: string;
	readonly returnedBytes: number;
	readonly totalBytes: number;
}): TruncationInfo {
	const base = {
		reason: 'content-truncated',
		returnedBytes,
		totalBytes,
		itemNoun,
		toolName,
	} as const;

	if (section === undefined) {
		const outline = toOutlineLines(entries, totalBytes);
		// A page whose only entry is the lead has no heading to narrow to, and
		// section 0 of such a page is the page, so naming it returns these same
		// bytes. Not naming get-page "again" keeps the sentence true for a
		// get-pages caller, which never called get-page in the first place.
		if (outline.length === 1) {
			return {
				...base,
				remedyHint: 'The page has no sections, so no narrower read returns more of it.',
			};
		}
		return {
			...base,
			sections: outline,
			remedyHint: 'To read a specific section, call get-page with section=N.',
		};
	}

	const subsections = editableChildrenOf(entries, String(section));
	if (subsections.length === 0) {
		return {
			...base,
			remedyHint:
				"No narrower read returns more of this section. To change part of it, use update-page with operation='find-replace'.",
		};
	}
	return {
		...base,
		sections: subsections.map((s) => `${s.index} (${s.line})`),
		remedyHint:
			'To read part of this section, call get-page again with one of the subsection numbers listed.',
	};
}

/**
 * Marker for a whole-page read that returned only the outline because the page
 * is larger than the page-outline threshold. The way forward is a section read
 * (or `full=true`), stated here because this is the response the caller sees
 * exactly when the cost is incurred.
 */
export function omittedContentTruncation({
	entries,
	totalBytes,
	itemNoun,
	toolName,
}: {
	readonly entries: readonly SectionEntry[];
	readonly totalBytes: number;
	readonly itemNoun: string;
	readonly toolName: string;
}): TruncationInfo {
	const outline = toOutlineLines(entries, totalBytes);
	return {
		reason: 'content-omitted',
		totalBytes,
		itemNoun,
		toolName,
		sections: outline,
		remedyHint:
			outline.length > 1
				? 'The page is large, so only its outline is shown. Call get-page with section=N to read one section, or pass full=true to read the whole page (truncated at the byte cap).'
				: 'The page has no sections, so pass full=true to read it (truncated at the byte cap).',
	};
}
