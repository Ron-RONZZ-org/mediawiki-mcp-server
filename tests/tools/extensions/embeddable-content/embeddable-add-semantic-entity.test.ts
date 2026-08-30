import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';
import { clearVocabularyCache } from '../../../../src/tools/extensions/embeddable-content/embeddableVocabulary.ts';
import { embeddableAddSemanticEntity } from '../../../../src/tools/extensions/embeddable-content/embeddable-add-semantic-entity.ts';
import { vocabularyRequestResponse } from './vocabFixture.ts';

const CREATED = { entity: { id: 'Q777', type: 'item', lastrevid: 12 }, success: 1 };

const baseEdit = fakeContext().edit;

function contextWith(
	submit = vi.fn().mockResolvedValue(CREATED),
	readEntityResponse?: unknown,
	searchResponse?: unknown,
) {
	const mock = createMockMwn({
		request: vi.fn((params: { action?: string; props?: string }) => {
			if (params.action === 'wbsearchentities') {
				return Promise.resolve(searchResponse ?? { search: [{ id: 'Q57', label: 'Python' }] });
			}
			if (params.action === 'wbgetentities' && params.props?.includes('claims')) {
				return Promise.resolve(
					readEntityResponse ?? { entities: { Q42: { id: 'Q42', type: 'item', claims: {} } } },
				);
			}
			return Promise.resolve(vocabularyRequestResponse());
		}),
	});
	const ctx = fakeContext({
		mwn: async () => mock as never,
		edit: { ...baseEdit, submit },
	});
	return { mock, ctx, submit };
}

// oxlint-disable-next-line typescript/no-explicit-any -- test helper reaching into arbitrary claim shapes; any is intentional for test ergonomics
function byProperty(data: { claims: { mainsnak: { property: string } }[] }): Record<string, any> {
	return Object.fromEntries(data.claims.map((c) => [c.mainsnak.property, c]));
}

beforeEach(() => {
	clearVocabularyCache();
});

describe('embeddable-add-semantic-entity', () => {
	it('creates a person with the derived label, birth data and external IDs', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'person',
				givenName: 'Ada',
				familyName: 'Lovelace',
				dateOfBirth: '1815-12-10',
				placeOfBirth: 'Q42',
				orcid: '0000-0001-0002-0003',
				viafId: '123456789',
				officialWebsite: 'https://example.org/ada',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(data.labels).toEqual({ en: { language: 'en', value: 'Ada Lovelace' } });
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q6');
		expect(byProperty(data).P50.mainsnak.datavalue.value.time).toBe('+1815-12-10T00:00:00Z');
		expect(byProperty(data).P51.mainsnak.datavalue.value.id).toBe('Q42');
		expect(byProperty(data).P13.mainsnak.datavalue.value).toBe('0000-0001-0002-0003');
		expect(byProperty(data).P14.mainsnak.datavalue.value).toBe('123456789');
		expect(byProperty(data).P36.mainsnak.datavalue.value).toBe('https://example.org/ada');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', created: true });
	});

	it('creates software classified under the FOSS class with entity and URL facts', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'software',
				label: 'Flameshot',
				developer: 'Q6',
				license: 'Q302',
				programmingLanguage: 'Python',
				operatingSystem: 'Q304, Q308',
				sourceCodeRepository: 'https://github.com/flameshot-org/flameshot',
				officialWebsite: 'https://flameshot.org',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q179');
		expect(byProperty(data).P33.mainsnak.datavalue.value.id).toBe('Q6');
		expect(byProperty(data).P34.mainsnak.datavalue.value.id).toBe('Q302');
		// Programming language resolved by label to the fixture item.
		expect(byProperty(data).P5.mainsnak.datavalue.value.id).toBe('Q57');
		const oss = data.claims.filter(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property === 'P35',
		);
		expect(
			oss.map(
				(o: { mainsnak: { datavalue: { value: { id: string } } } }) =>
					o.mainsnak.datavalue.value.id,
			),
		).toEqual(['Q304', 'Q308']);
		expect(byProperty(data).P37.mainsnak.datavalue.value).toBe(
			'https://github.com/flameshot-org/flameshot',
		);
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777' });
	});

	it('creates a collective under a preset class, defaulting to organization', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'collective',
				label: 'Example Org',
				collectiveClass: 'non-profit-organization',
				parentOrganization: 'Q7',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q343');
		expect(byProperty(data).P60.mainsnak.datavalue.value.id).toBe('Q7');
	});

	it('accepts a direct item ID as the collective class', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'collective',
				label: 'Custom Org',
				collectiveClass: 'Q351',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q351');
	});

	it('creates a fictional character with the suffixed label and auto-description', async () => {
		const submit = vi.fn().mockResolvedValue(CREATED);

		const mock = createMockMwn({
			request: vi.fn((params: { action?: string; ids?: string }) => {
				if (params.action === 'wbgetentities' && params.ids === 'Q42') {
					// present-in-work label lookup: Q42 → "A Study in Scarlet"
					return Promise.resolve({
						entities: { Q42: { id: 'Q42', labels: { en: { value: 'A Study in Scarlet' } } } },
					});
				}
				return Promise.resolve(vocabularyRequestResponse());
			}),
		});
		const ctxFc = fakeContext({ mwn: async () => mock as never, edit: { ...baseEdit, submit } });

		await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'fictional-character',
				givenName: 'Sherlock',
				familyName: 'Holmes',
				presentInWork: 'Q42',
			}),
			ctxFc,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(data.labels).toEqual({
			en: { language: 'en', value: 'Sherlock Holmes (fictional character)' },
		});
		expect(data.descriptions).toEqual({
			en: { language: 'en', value: 'fictional character in A Study in Scarlet' },
		});
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q364');
		expect(byProperty(data).P59.mainsnak.datavalue.value.id).toBe('Q42');
	});

	it('creates an other item from instanceOf and raw statements', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'other',
				label: 'Anything',
				instanceOf: 'Q163',
				statements: [
					{
						mainsnak: {
							snaktype: 'value',
							property: 'P42',
							datavalue: { type: 'string', value: 'slogan' },
						},
						type: 'statement',
						rank: 'normal',
					},
				],
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		expect(byProperty(data).P1.mainsnak.datavalue.value.id).toBe('Q163');
		expect(byProperty(data).P42.mainsnak.datavalue.value).toBe('slogan');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777' });
	});

	it('rejects a field the kind does not expose', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'person',
				givenName: 'Ada',
				developer: 'Q6',
			}),
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('developer');
		expect(submit).not.toHaveBeenCalled();
	});

	it('requires a name or label on create', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, { kind: 'person' }),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('requires instanceOf for kind=other on create', async () => {
		const { ctx, submit } = contextWith();

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, { kind: 'other', label: 'X' }),
			ctx,
		);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects a bad date and a bad URL', async () => {
		const { ctx, submit } = contextWith();

		const badDate = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'person',
				givenName: 'Ada',
				dateOfBirth: '1815-13-40',
			}),
			ctx,
		);
		assertStructuredError(badDate, 'invalid_input');

		const badUrl = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'software',
				label: 'X',
				officialWebsite: 'ftp://example.org',
			}),
			ctx,
		);
		assertStructuredError(badUrl, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('updates an existing item, replacing only the provided statements', async () => {
		const existing = {
			entities: {
				Q777: {
					id: 'Q777',
					type: 'item',
					claims: {
						P1: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P1',
									datavalue: {
										type: 'wikibase-entityid',
										value: { 'entity-type': 'item', id: 'Q6' },
									},
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c1',
							},
						],
						P13: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P13',
									datavalue: { type: 'string', value: 'old-orcid' },
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c2',
							},
						],
						P36: [
							{
								mainsnak: {
									snaktype: 'value',
									property: 'P36',
									datavalue: { type: 'string', value: 'https://old.example' },
								},
								type: 'statement',
								rank: 'normal',
								id: 'Q777$c3',
							},
						],
					},
				},
			},
		};
		const submit = vi
			.fn()
			.mockResolvedValue({ entity: { id: 'Q777', type: 'item', lastrevid: 13 }, success: 1 });
		const { ctx } = contextWith(submit, existing);

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, {
				kind: 'person',
				qid: 'Q777',
				orcid: '0000-0000-0000-0001',
			}),
			ctx,
		);

		const data = JSON.parse(submit.mock.calls[0][1].data);
		const properties = data.claims.map(
			(c: { mainsnak: { property: string } }) => c.mainsnak.property,
		);
		expect(properties.filter((p: string) => p === 'P1')).toHaveLength(1);
		// Old ORCID replaced; website kept with its GUID.
		expect(data.claims.find((c: { id?: string }) => c.id === 'Q777$c2')).toBeUndefined();
		expect(data.claims.find((c: { id?: string }) => c.id === 'Q777$c3')).toBeDefined();
		const newOrcid = data.claims.find(
			(c: { mainsnak: { property: string }; id?: string }) =>
				c.mainsnak.property === 'P13' && c.id === undefined,
		);
		expect(newOrcid.mainsnak.datavalue.value).toBe('0000-0000-0000-0001');
		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', updated: true });
	});

	it('reports a missing update target as not_found', async () => {
		const { ctx, submit } = contextWith(vi.fn(), {
			entities: { Q999: { id: 'Q999', missing: '' } },
		});

		const result = await embeddableAddSemanticEntity.handle(
			toolArgs(embeddableAddSemanticEntity, { kind: 'person', qid: 'Q999', givenName: 'Ada' }),
			ctx,
		);

		assertStructuredError(result, 'not_found');
		expect(submit).not.toHaveBeenCalled();
	});

	it('is annotated as a write tool so the read-only gate covers it', () => {
		expect(embeddableAddSemanticEntity.annotations.readOnlyHint).toBe(false);
	});
});
