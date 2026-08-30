import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { embeddableAddCitationSource } from '../../../../src/tools/extensions/embeddable-content/embeddable-add-citation-source.ts';
import { dispatch } from '../../../../src/runtime/dispatcher.ts';

const CREATED = {
	source: {
		entityId: 'Q777',
		entityType: 'item',
		latestRevisionId: 12,
		created: true,
		pageTitle: 'Source:The Hobbit (Book)',
	},
};

const UPDATED = {
	source: { entityId: 'Q777', entityType: 'item', latestRevisionId: 13, updated: true },
};

function contextWith(result: unknown) {
	const submit = vi.fn().mockResolvedValue(result);
	const mock = createMockMwn({ request: vi.fn() });
	const ctx = fakeContext({
		mwn: async () => mock as never,
		edit: { ...fakeContext().edit, submit },
	});
	return { ctx, submit };
}

describe('embeddable-add-citation-source', () => {
	it('forwards the fields to the wiki action=addsource module on create', async () => {
		const { ctx, submit } = contextWith(CREATED);

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6, Q94',
				publisher: 'Q42',
				pages: '1-300',
				year: '1937',
				isbn: '9780547928227',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).toMatchObject({
			action: 'addsource',
			class: 'book',
			title: 'The Hobbit',
			authors: 'Q6, Q94',
			publisher: 'Q42',
			pages: '1-300',
			year: '1937',
			isbn: '9780547928227',
		});
		expect(assertStructuredData(result)).toMatchObject({
			entityId: 'Q777',
			latestRevisionId: 12,
			created: true,
			pageTitle: 'Source:The Hobbit (Book)',
		});
	});

	it('leaves blank fields out of the request', async () => {
		const { ctx, submit } = contextWith(CREATED);

		await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'webpage',
				title: 'A Page',
				authors: 'Q6',
				url: 'https://example.org/page',
				parent: 'Q42',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).not.toHaveProperty('year');
		expect(params).not.toHaveProperty('isbn');
		expect(params).not.toHaveProperty('description');
		expect(params).toMatchObject({ class: 'webpage', parent: 'Q42' });
	});

	it('forwards qid (uppercased) for an update', async () => {
		const { ctx, submit } = contextWith(UPDATED);

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				qid: 'q777',
				isbn: '9780547928227',
			}),
			ctx,
		);

		const params = submit.mock.calls[0][1];
		expect(params).toMatchObject({ action: 'addsource', qid: 'Q777', isbn: '9780547928227' });
		expect(params).not.toHaveProperty('title');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', updated: true });
	});

	it('passes the comment as the edit summary', async () => {
		const { ctx, submit } = contextWith(CREATED);

		await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
				comment: 'adding the reference',
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ summary: 'adding the reference' });
	});

	it('reports an empty wiki answer as an upstream failure', async () => {
		const { ctx } = contextWith({});

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, { classKey: 'book', title: 'X', authors: 'Q6' }),
			ctx,
		);

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('returned no source result');
	});

	it('surfaces wiki-side rejections as errors via the dispatcher', async () => {
		const mock = createMockMwn({ request: vi.fn() });
		const submit = vi
			.fn()
			.mockRejectedValue(new Error('classKey webpage does not expose the field(s) journal.'));
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...fakeContext().edit, submit },
		});

		const result = await dispatch(
			embeddableAddCitationSource,
			ctx,
		)({
			classKey: 'webpage',
			title: 'A Page',
			authors: 'Q6',
			journal: 'Q42',
		});

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('does not expose the field(s) journal');
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(embeddableAddCitationSource.annotations.readOnlyHint).toBe(false);
	});
});
