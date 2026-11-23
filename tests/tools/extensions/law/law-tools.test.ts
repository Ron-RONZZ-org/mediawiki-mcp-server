import { describe, it, expect, vi } from 'vitest';
import { lawSearch } from '../../../../src/tools/extensions/law/law-search.ts';
import { lawGet } from '../../../../src/tools/extensions/law/law-get.ts';
import { lawCite } from '../../../../src/tools/extensions/law/law-cite.ts';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { contextOn } from '../../../helpers/fakeContext.ts';
import { assertStructuredData } from '../../../helpers/structuredResult.ts';

describe('law-search', () => {
	it('forwards the query and limits to action=lawsearch', async () => {
		const request = vi.fn().mockResolvedValue({
			lawsearch: {
				laws: [{ law_key: 'LEGITEXT000006071191', title: "Code de l'éducation" }],
				articles: [],
				limit: 10,
			},
		});
		const ctx = contextOn(createMockMwn({ request }));

		const result = await lawSearch.handle({ q: 'L111-1', jurisdiction: 'FR', limit: 10 }, ctx);

		expect(request.mock.calls[0][0]).toMatchObject({
			action: 'lawsearch',
			q: 'L111-1',
			jurisdiction: 'FR',
			limit: 10,
		});
		expect(assertStructuredData(result).laws).toEqual([
			{ law_key: 'LEGITEXT000006071191', title: "Code de l'éducation" },
		]);
	});
});

describe('law-get', () => {
	it('reads one article through action=lawget', async () => {
		const request = vi.fn().mockResolvedValue({
			lawget: { law: { law_key: 'LEGITEXT000006071191' }, article: { reference_code: 'L111-1' } },
		});
		const ctx = contextOn(createMockMwn({ request }));

		const result = await lawGet.handle(
			{ law: 'LEGITEXT000006071191', article: 'L111-1', language: 'fr' },
			ctx,
		);

		expect(request.mock.calls[0][0]).toMatchObject({
			action: 'lawget',
			law: 'LEGITEXT000006071191',
			article: 'L111-1',
			language: 'fr',
		});
		expect(assertStructuredData(result).article).toEqual({ reference_code: 'L111-1' });
	});
});

describe('law-cite', () => {
	it('submits action=lawcite through the edit service', async () => {
		const submit = vi.fn().mockResolvedValue({
			lawcite: {
				qid: 'Q123',
				ref: '<ref>{{#cite:Q123}}</ref>',
				created: true,
				law_key: 'LEGITEXT000006071191',
				reference_code: 'L111-1',
			},
		});
		const ctx = contextOn(createMockMwn(), { edit: { submit } as never });

		const result = await lawCite.handle({ law: 'LEGITEXT000006071191', article: 'L111-1' }, ctx);

		expect(submit.mock.calls[0][1]).toMatchObject({
			action: 'lawcite',
			law: 'LEGITEXT000006071191',
			article: 'L111-1',
		});
		expect(assertStructuredData(result).qid).toBe('Q123');
	});

	it('cites a court decision without an article', async () => {
		const submit = vi.fn().mockResolvedValue({
			lawcite: {
				qid: 'Q456',
				ref: '<ref>{{#cite:Q456}}</ref>',
				created: true,
				law_key: 'CONSTEXT000017667855',
				reference_code: 'décision',
			},
		});
		const ctx = contextOn(createMockMwn(), { edit: { submit } as never });

		const result = await lawCite.handle({ law: 'CONSTEXT000017667855' }, ctx);

		expect(submit.mock.calls[0][1]).toMatchObject({
			action: 'lawcite',
			law: 'CONSTEXT000017667855',
		});
		expect(submit.mock.calls[0][1]).not.toHaveProperty('article');
		expect(assertStructuredData(result).qid).toBe('Q456');
	});
});
