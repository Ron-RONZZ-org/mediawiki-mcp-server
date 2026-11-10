import { afterAll, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { fakeContext } from '../../../helpers/fakeContext.ts';
import { toolArgs } from '../../../helpers/toolArgs.ts';
import { UploadDirsImpl } from '../../../../src/wikis/uploadDirs.ts';
import {
	assertStructuredData,
	assertStructuredError,
	assertStructuredSuccess,
} from '../../../helpers/structuredResult.ts';
import { embeddableAddCitationSource } from '../../../../src/tools/extensions/embeddable-content/embeddable-add-citation-source.ts';
import { dispatch } from '../../../../src/runtime/dispatcher.ts';

const CREATED = {
	source: {
		entityId: 'Q777',
		entityType: 'item',
		latestRevisionId: 12,
		created: true,
		pageTitle: 'Source:The Hobbit (Book)',
		label: 'The Hobbit (Book)',
	},
};

const UPDATED = {
	source: { entityId: 'Q777', entityType: 'item', latestRevisionId: 13, updated: true },
};

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

function contextWith(result: unknown = CREATED, request?: (p: unknown) => unknown) {
	const submit = vi.fn().mockResolvedValue(result);
	const mock = createMockMwn({ request: vi.fn(request ?? (() => ({}))) });
	const ctx = fakeContext({
		mwn: async () => mock as never,
		edit: { ...baseEdit, submit },
	});
	return { mock, ctx, submit };
}

describe('embeddable-add-citation-source', () => {
	it('forwards the Zotero/CSL-aligned classes and fields (contract-driven)', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'legal-case',
				title: 'Roe v. Wade',
				court: 'Q1',
				caseNumber: '410 U.S. 113',
				international: 'yes',
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({
			action: 'addsource',
			class: 'legal-case',
			court: 'Q1',
			caseNumber: '410 U.S. 113',
			international: 'yes',
		});
	});

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

	it('treats the wiki string flags (created: "1") as created', async () => {
		// MediaWiki's ApiResult serializes true as '' — the API modules
		// return '1' instead; the tool must read either form.
		const { ctx } = contextWith({
			source: { entityId: 'Q777', entityType: 'item', latestRevisionId: 12, created: '1' },
		});

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, { classKey: 'book', title: 'X', authors: 'Q6' }),
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({ entityId: 'Q777', created: true });
	});

	it('reports a duplication-guard refusal as a not-created result naming the duplicate', async () => {
		const { ctx } = contextWith({
			source: {
				duplicate: '1',
				duplicateOf: 'Q777',
				duplicateLabel: 'The Hobbit (Book)',
				match: 'label',
			},
		});

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
			}),
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({
			notCreated: 'duplicate',
			duplicateOf: 'Q777',
			duplicateLabel: 'The Hobbit (Book)',
			match: 'label',
		});
		expect(assertStructuredSuccess(result)).toContain('Not created: duplicate');
	});

	it('forwards confirmDuplicate to force a create past the guard', async () => {
		const { ctx, submit } = contextWith();

		await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
				confirmDuplicate: true,
			}),
			ctx,
		);

		expect(submit.mock.calls[0][1]).toMatchObject({ confirmDuplicate: '1' });
	});

	it('checks the term store when a create response is lost and the item exists', async () => {
		const { ctx } = contextWith({}, () => ({
			search: [{ id: 'Q777', label: 'The Hobbit (Book)' }],
		}));

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
			}),
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({
			outcome: 'likely-created',
			entityId: 'Q777',
		});
	});

	it('reports a lost create response as retry-safe when no matching item exists', async () => {
		const { ctx } = contextWith({});

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				title: 'The Hobbit',
				authors: 'Q6',
			}),
			ctx,
		);

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('was not created');
		expect(envelope.message).toContain('retrying the call is safe');
	});

	it('reports a lost update response as safe to re-run, without a search', async () => {
		const { ctx, mock } = contextWith({});

		const result = await embeddableAddCitationSource.handle(
			toolArgs(embeddableAddCitationSource, {
				classKey: 'book',
				qid: 'q777',
				isbn: '9780547928227',
			}),
			ctx,
		);

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toContain('update of Q777');
		expect(mock.request).not.toHaveBeenCalled();
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

	describe('accessFile', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mcp-access-'));
		const file = join(dir, 'paper.pdf');
		writeFileSync(file, '%PDF-1.4\n%%EOF\n');
		afterAll(() => rmSync(dir, { recursive: true, force: true }));

		const ATTACHED = {
			source: {
				accessFile: {
					fileId: 'Q900',
					fileTitle: 'The-Hobbit-(Book).pdf',
					public: false,
					alreadyLinked: false,
				},
			},
		};

		function accessContext(attachResult: unknown = ATTACHED) {
			const submit = vi.fn().mockResolvedValueOnce(CREATED).mockResolvedValueOnce(attachResult);
			const submitAccessUpload = vi.fn().mockResolvedValue({
				fileTitle: 'The-Hobbit-(Book).pdf',
				fileUrl: 'https://wiki.example/File:The-Hobbit-(Book).pdf',
			});
			const mock = createMockMwn({ request: vi.fn(() => ({})) });
			const ctx = fakeContext({
				mwn: async () => mock as never,
				uploadDirs: new UploadDirsImpl([dir]),
				edit: { ...baseEdit, submit, submitAccessUpload },
			});
			return { ctx, submit, submitAccessUpload };
		}

		it('creates the source, uploads the bytes, then attaches (internal by default)', async () => {
			const { ctx, submit, submitAccessUpload } = accessContext();

			const result = await embeddableAddCitationSource.handle(
				toolArgs(embeddableAddCitationSource, {
					classKey: 'book',
					title: 'The Hobbit',
					accessFile: { filepath: file },
				}),
				ctx,
			);

			// The first call never carries accessFile (the file does not exist yet).
			expect(submit.mock.calls[0][1]).not.toHaveProperty('accessFile');
			// The wiki names the File: page from the SOURCE label.
			expect(submitAccessUpload).toHaveBeenCalledWith(
				expect.anything(),
				file,
				'The Hobbit (Book)',
				'',
				true,
			);
			const attach = submit.mock.calls[1][1];
			expect(attach).toMatchObject({ action: 'addsource', class: 'book', qid: 'Q777' });
			expect(JSON.parse(String(attach.accessFile))).toEqual({
				fileTitle: 'The-Hobbit-(Book).pdf',
				internal: true,
			});
			expect(assertStructuredData(result)).toMatchObject({
				entityId: 'Q777',
				accessFile: { fileId: 'Q900', fileTitle: 'The-Hobbit-(Book).pdf' },
			});
		});

		it('passes a public licence through to the attach call', async () => {
			const { ctx, submit } = accessContext({
				source: { accessFile: { fileId: 'Q901', public: true, alreadyLinked: false } },
			});

			await embeddableAddCitationSource.handle(
				toolArgs(embeddableAddCitationSource, {
					classKey: 'book',
					title: 'The Hobbit',
					accessFile: { filepath: file, internal: false, license: 'Q320', language: 'en' },
				}),
				ctx,
			);

			expect(JSON.parse(String(submit.mock.calls[1][1].accessFile))).toEqual({
				fileTitle: 'The-Hobbit-(Book).pdf',
				internal: false,
				license: 'Q320',
				language: 'en',
			});
		});

		it('rejects a public file without a licence before any write', async () => {
			const { ctx, submit } = accessContext();

			const result = await embeddableAddCitationSource.handle(
				toolArgs(embeddableAddCitationSource, {
					classKey: 'book',
					title: 'The Hobbit',
					accessFile: { filepath: file, internal: false },
				}),
				ctx,
			);

			assertStructuredError(result, 'invalid_input');
			expect(submit).not.toHaveBeenCalled();
		});

		it('rejects a path outside the upload directories before any write', async () => {
			const { ctx, submit } = accessContext();

			const result = await embeddableAddCitationSource.handle(
				toolArgs(embeddableAddCitationSource, {
					classKey: 'book',
					title: 'The Hobbit',
					accessFile: { filepath: '/etc/passwd' },
				}),
				ctx,
			);

			assertStructuredError(result, 'invalid_input');
			expect(submit).not.toHaveBeenCalled();
		});

		it('reports a partial result when the attach fails after the upload', async () => {
			const submit = vi
				.fn()
				.mockResolvedValueOnce(CREATED)
				.mockRejectedValueOnce(new Error('invalid_access_file'));
			const mock = createMockMwn({ request: vi.fn(() => ({})) });
			const ctx = fakeContext({
				mwn: async () => mock as never,
				uploadDirs: new UploadDirsImpl([dir]),
				edit: {
					...baseEdit,
					submit,
					submitAccessUpload: vi.fn().mockResolvedValue({
						fileTitle: 'The-Hobbit-(Book).pdf',
						fileUrl: 'https://wiki.example/File:The-Hobbit-(Book).pdf',
					}),
				},
			});

			const result = await embeddableAddCitationSource.handle(
				toolArgs(embeddableAddCitationSource, {
					classKey: 'book',
					title: 'The Hobbit',
					accessFile: { filepath: file },
				}),
				ctx,
			);

			expect(assertStructuredData(result)).toMatchObject({
				partial: true,
				accessFile: { fileTitle: 'The-Hobbit-(Book).pdf' },
			});
		});
	});
});
