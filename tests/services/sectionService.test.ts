import { describe, it, expect, vi } from 'vitest';
import {
	SectionServiceImpl,
	resolveSectionName,
	toOutlineLines,
} from '../../src/services/sectionService.ts';

function mockWithSections(sections: unknown[]) {
	return {
		request: vi.fn().mockResolvedValue({ parse: { sections } }),
	};
}

describe('SectionServiceImpl', () => {
	it('carries the section id, heading level and text', async () => {
		const mock = mockWithSections([
			{ index: '1', level: '2', line: 'Etymology' },
			{ index: '2', level: '2', line: 'History' },
			{ index: '3', level: '3', line: 'Feudal era' },
		]);

		expect(await new SectionServiceImpl().list(mock as never, 'Japan')).toEqual([
			{ index: '1', level: 2, line: 'Etymology', editable: true },
			{ index: '2', level: 2, line: 'History', editable: true },
			{ index: '3', level: 3, line: 'Feudal era', editable: true },
		]);
	});

	// A transcluded section carries a `T-` prefixed id and cannot be edited on
	// the host page, so a caller must never be handed it as a section number.
	it('marks a transcluded section as not editable', async () => {
		const mock = mockWithSections([
			{ index: 'T-1', level: '2', line: 'About administrators' },
			{ index: '1', level: '2', line: 'Current nominations' },
		]);

		const result = await new SectionServiceImpl().list(mock as never, 'RfA');
		expect(result[0]).toMatchObject({ index: 'T-1', editable: false });
		expect(result[1]).toMatchObject({ index: '1', editable: true });
	});

	it('returns an empty list for a page with no headings', async () => {
		expect(await new SectionServiceImpl().list(mockWithSections([]) as never, 'Empty')).toEqual([]);
	});
});

describe('listInSource', () => {
	it('sends the source to be parsed in the context of the named page', async () => {
		const mock = mockWithSections([]);

		await new SectionServiceImpl().listInSource(mock as never, 'Japan', '== History ==\nBody.');

		expect(mock.request).toHaveBeenCalledWith({
			action: 'parse',
			text: '== History ==\nBody.',
			title: 'Japan',
			contentmodel: 'wikitext',
			prop: 'sections',
			formatversion: '2',
		});
	});

	it('carries the section id, heading level and text', async () => {
		const mock = mockWithSections([
			{ index: '1', level: '2', line: 'History' },
			{ index: '2', level: '3', line: 'Feudal era' },
		]);

		expect(
			await new SectionServiceImpl().listInSource(mock as never, 'Japan', 'irrelevant'),
		).toEqual([
			{ index: '1', level: 2, line: 'History', editable: true },
			{ index: '2', level: 3, line: 'Feudal era', editable: true },
		]);
	});

	// A template in the source expands to sections the caller did not write;
	// the parser reports them with `T-` ids, exactly as on a stored page.
	it('marks a template-expanded section as not editable', async () => {
		const mock = mockWithSections([
			{ index: '1', level: '2', line: 'History' },
			{ index: 'T-1', level: '3', line: 'Transcluded child' },
		]);

		const result = await new SectionServiceImpl().listInSource(
			mock as never,
			'Japan',
			'== History ==\n{{Probe}}',
		);

		expect(result[1]).toMatchObject({ index: 'T-1', editable: false });
	});
});

describe('toOutlineLines', () => {
	it('numbers each entry with the section number it is edited by', () => {
		expect(
			toOutlineLines([
				{ index: '1', level: 2, line: 'Etymology', editable: true },
				{ index: '2', level: 2, line: 'History', editable: true },
			]),
		).toEqual(['0 (Lead)', '1 (Etymology)', '2 (History)']);
	});

	// A transcluded heading occupies a position in the outline but is not
	// addressable by section number, so listing it shifts every later heading
	// away from the number that edits it.
	it('omits transcluded headings, which no section number addresses', () => {
		expect(
			toOutlineLines([
				{ index: 'T-1', level: 2, line: 'From a template', editable: false },
				{ index: '1', level: 2, line: 'Etymology', editable: true },
			]),
		).toEqual(['0 (Lead)', '1 (Etymology)']);
	});

	it('renders a page with no headings as the lead alone', () => {
		expect(toOutlineLines([])).toEqual(['0 (Lead)']);
	});
});

describe('toOutlineLines sizes', () => {
	const entries = [
		{ index: '1', level: 2, line: 'A', editable: true, byteOffset: 100 },
		{ index: '2', level: 2, line: 'B', editable: true, byteOffset: 2100 },
	];
	it('appends the per-section size when the page total is known', () => {
		expect(toOutlineLines(entries, 5000)).toEqual([
			'0 (Lead) — 100 B',
			'1 (A) — 2.0 KB',
			'2 (B) — 2.8 KB',
		]);
	});
	it('keeps the bare outline when no total is given', () => {
		expect(toOutlineLines(entries)).toEqual(['0 (Lead)', '1 (A)', '2 (B)']);
	});
});

describe('resolveSectionName', () => {
	const entries = [
		{ index: '1', level: 2, line: 'History', editable: true },
		{ index: '2', level: 2, line: 'Geography', editable: true },
		{ index: '3', level: 2, line: 'Changes', editable: true },
		{ index: '4', level: 2, line: 'Changes', editable: true },
	];
	it('resolves a numeric string', () => {
		expect(resolveSectionName('2', entries)).toEqual({ number: 2 });
	});
	it('resolves a heading name case-insensitively', () => {
		expect(resolveSectionName('history', entries)).toEqual({ number: 1 });
	});
	it('resolves the lead', () => {
		expect(resolveSectionName('Lead', entries)).toEqual({ number: 0 });
	});
	it('refuses an ambiguous name with the candidate numbers', () => {
		const result = resolveSectionName('changes', entries);
		expect('error' in result && result.error).toContain('3 (Changes)');
	});
	it('reports no match with the available names', () => {
		const result = resolveSectionName('Nope', entries);
		expect('error' in result && result.error).toContain('History');
	});
});
