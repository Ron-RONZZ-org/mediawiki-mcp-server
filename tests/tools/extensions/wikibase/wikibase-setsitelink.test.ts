import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext, withoutEditAttribution } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { wikibaseSetSitelink } from '../../../../src/tools/extensions/wikibase/wikibase-setsitelink.ts';

const LINKED = {
	entity: { id: 'Q42', lastrevid: 99 },
	success: 1,
};

const baseEdit = fakeContext().edit;

describe('wikibase-setsitelink', () => {
	it('links a page to an item on the wikibase site', async () => {
		const mock = createMockMwn({});
		const submit = vi.fn().mockResolvedValue(LINKED);
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseSetSitelink.handle(
			toolArgs(wikibaseSetSitelink, { qid: 'Q42', page: 'Cheatsheets:Markdown' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({
			action: 'wbsetsitelink',
			id: 'Q42',
			linksite: 'wikibase',
			linktitle: 'Cheatsheets:Markdown',
		});
		expect(assertStructuredData(result)).toMatchObject({
			entityId: 'Q42',
			latestRevisionId: 99,
			page: 'Cheatsheets:Markdown',
		});
	});

	it('passes a custom site through', async () => {
		const mock = createMockMwn({});
		const submit = vi.fn().mockResolvedValue(LINKED);
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		await wikibaseSetSitelink.handle(
			toolArgs(wikibaseSetSitelink, { qid: 'Q42', page: 'Foo', site: 'frwikibase' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ linksite: 'frwikibase' });
	});

	it('reports a write that returned no entity as upstream_failure', async () => {
		const mock = createMockMwn({});
		const submit = vi.fn().mockResolvedValue({ success: 1 });
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseSetSitelink.handle(
			toolArgs(wikibaseSetSitelink, { qid: 'Q42', page: 'Foo' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});

	it('attributes the edit to the tool that made it, after the caller comment', async () => {
		const mock = createMockMwn({});
		const submit = vi.fn().mockResolvedValue(LINKED);
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		await wikibaseSetSitelink.handle(
			toolArgs(wikibaseSetSitelink, { qid: 'Q42', page: 'Foo', comment: 'linking the cheatsheet' }),
			ctx,
		);

		expect(submit.mock.calls[0][1].summary).toContain(
			'linking the cheatsheet (via wikibase-setsitelink',
		);
	});

	it('drops the attribution for a wiki that opts out of it', async () => {
		const mock = createMockMwn({});
		const submit = vi.fn().mockResolvedValue(LINKED);
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		await wikibaseSetSitelink.handle(
			toolArgs(wikibaseSetSitelink, { qid: 'Q42', page: 'Foo', comment: 'linking' }),
			withoutEditAttribution(ctx),
		);

		expect(submit.mock.calls[0][1].summary).toBe('linking');
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(wikibaseSetSitelink.annotations.readOnlyHint).toBe(false);
	});
});
