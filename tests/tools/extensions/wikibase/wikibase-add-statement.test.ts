import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext, withoutEditAttribution } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { wikibaseAddStatement } from '../../../../src/tools/extensions/wikibase/wikibase-add-statement.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';

const CREATED = {
	claim: { id: 'Q42$8f1a', type: 'statement', rank: 'normal' },
	pageinfo: { lastrevid: 555 },
	success: 1,
};

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

function contextWith(datatype: string, submit = vi.fn().mockResolvedValue(CREATED)) {
	const mock = createMockMwn({
		request: vi.fn().mockResolvedValue({
			entities: { P31: { id: 'P31', type: 'property', datatype } },
		}),
	});
	const ctx = fakeContext({
		mwn: async () => mock as never,
		edit: { ...baseEdit, submit },
	});
	return { mock, ctx, submit };
}

describe('wikibase-add-statement', () => {
	it('builds an item snak from a Q-id value', async () => {
		const { ctx, submit } = contextWith('wikibase-item');

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'Q5' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({
			action: 'wbcreateclaim',
			entity: 'Q42',
			property: 'P31',
			snaktype: 'value',
			value: JSON.stringify({ 'entity-type': 'item', id: 'Q5' }),
		});
		expect(assertStructuredData(result)).toMatchObject({
			statementId: 'Q42$8f1a',
			latestRevisionId: 555,
		});
	});

	it('looks the property datatype up before building the snak', async () => {
		const { mock, ctx } = contextWith('wikibase-item');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'Q5' }),
			ctx,
		);

		expect(mock.request.mock.calls[0][0]).toMatchObject({
			action: 'wbgetentities',
			ids: 'P31',
			props: 'datatype',
		});
	});

	it('sends a string value as a JSON string', async () => {
		const { ctx, submit } = contextWith('string');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'hello' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ value: '"hello"' });
	});

	it('sends an external-id value as a JSON string', async () => {
		const { ctx, submit } = contextWith('external-id');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: '90196888' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ value: '"90196888"' });
	});

	it('sends a url value as a JSON string', async () => {
		const { ctx, submit } = contextWith('url');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, {
				entityId: 'Q42',
				propertyId: 'P31',
				value: 'https://example.org',
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ value: '"https://example.org"' });
	});

	it('refuses a datatype it cannot build, naming it and the general write tool', async () => {
		const { ctx, submit } = contextWith('time');

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: '1952' }),
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('time');
		expect(envelope.message).toContain('wikibase-edit-entity');
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses a non-item value for an item-typed property', async () => {
		const { ctx, submit } = contextWith('wikibase-item');

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'human' }),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('reports an unknown property as not_found', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ entities: { P999: { id: 'P999', missing: '' } } }),
		});
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit } });

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P999', value: 'Q5' }),
			ctx,
		);

		expect(assertStructuredError(result, 'not_found').message).toContain('P999');
	});

	it('reports a property definition without a datatype as upstream_failure', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockResolvedValue({ entities: { P31: { id: 'P31', type: 'property' } } }),
		});
		const submit = vi.fn();
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'Q5' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
		expect(submit).not.toHaveBeenCalled();
	});

	it('reports a write that returned no statement as upstream_failure', async () => {
		const { ctx } = contextWith('string', vi.fn().mockResolvedValue({ success: 1 }));

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'hello' }),
			ctx,
		);

		assertStructuredError(result, 'upstream_failure');
	});

	it('verifies a landed statement when the write response is lost', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				entities: { P31: { id: 'P31', type: 'property', datatype: 'string' } },
			})
			.mockResolvedValueOnce({
				entities: {
					Q42: {
						id: 'Q42',
						type: 'item',
						lastrevid: 600,
						claims: {
							P31: [
								{
									id: 'Q42$abc',
									type: 'statement',
									mainsnak: {
										snaktype: 'value',
										property: 'P31',
										datavalue: { type: 'string', value: 'hello' },
									},
								},
							],
						},
					},
				},
			});
		const mock = createMockMwn({ request });
		const submit = vi.fn().mockResolvedValue({ success: 1 });
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'hello' }),
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({
			entityId: 'Q42',
			propertyId: 'P31',
			statementId: 'Q42$abc',
			latestRevisionId: 600,
		});
	});

	it('matches an item-typed claim by entity id when the response is lost', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				entities: { P31: { id: 'P31', type: 'property', datatype: 'wikibase-item' } },
			})
			.mockResolvedValueOnce({
				entities: {
					Q42: {
						id: 'Q42',
						type: 'item',
						claims: {
							P31: [
								{
									id: 'Q42$xyz',
									type: 'statement',
									mainsnak: {
										snaktype: 'value',
										property: 'P31',
										datavalue: {
											type: 'wikibase-entityid',
											value: { 'entity-type': 'item', 'numeric-id': 5, id: 'Q5' },
										},
									},
								},
							],
						},
					},
				},
			});
		const mock = createMockMwn({ request });
		const submit = vi.fn().mockResolvedValue({ success: 1 });
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'q5' }),
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({ statementId: 'Q42$xyz' });
	});

	it('reports a lost statement write that did not land as retry-safe', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				entities: { P31: { id: 'P31', type: 'property', datatype: 'string' } },
			})
			.mockResolvedValueOnce({
				entities: { Q42: { id: 'Q42', type: 'item', claims: { P31: [] } } },
			});
		const mock = createMockMwn({ request });
		const submit = vi.fn().mockResolvedValue({ success: 1 });
		const ctx = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'hello' }),
			ctx,
		);

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('was not added');
		expect(envelope.message).toContain('retrying the call is safe');
	});

	it('refuses a property ID where an item ID belongs', async () => {
		const { ctx, submit } = contextWith('wikibase-item');

		const result = await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'P279' }),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('attributes the edit to the tool that made it, after the caller comment', async () => {
		const { ctx, submit } = contextWith('string');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, {
				entityId: 'Q42',
				propertyId: 'P31',
				value: 'hello',
				comment: 'from a source',
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({
			summary: 'from a source (via wikibase-add-statement on MediaWiki MCP Server)',
		});
	});

	it('attributes an edit the caller gave no comment for', async () => {
		const { ctx, submit } = contextWith('string');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'Q42', propertyId: 'P31', value: 'hello' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({
			summary: 'Automated edit (via wikibase-add-statement on MediaWiki MCP Server)',
		});
	});

	it('drops the attribution for a wiki that opts out of it', async () => {
		const { ctx, submit } = contextWith('string');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, {
				entityId: 'Q42',
				propertyId: 'P31',
				value: 'hello',
				comment: 'from a source',
			}),
			withoutEditAttribution(ctx),
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ summary: 'from a source' });
	});

	it('adds a statement to a lexeme, which serialises its statements under claims', async () => {
		const { ctx, submit } = contextWith('wikibase-item');

		await wikibaseAddStatement.handle(
			toolArgs(wikibaseAddStatement, { entityId: 'L1', propertyId: 'P31', value: 'Q5' }),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ action: 'wbcreateclaim', entity: 'L1' });
	});

	it('rejects a MediaInfo id, naming the entity types it can write to', () => {
		expect(() =>
			toolArgs(wikibaseAddStatement, {
				entityId: 'M12017177',
				propertyId: 'P31',
				value: 'Q515',
			}),
		).toThrow(/Item, property or lexeme ID/);
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(wikibaseAddStatement.annotations.readOnlyHint).toBe(false);
	});
});
