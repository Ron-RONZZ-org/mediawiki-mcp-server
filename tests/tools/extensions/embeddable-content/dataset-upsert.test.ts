import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { datasetUpsert } from '../../../../src/tools/extensions/embeddable-content/dataset-upsert.ts';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { contextOn, uploadDirsResolving } from '../../../helpers/fakeContext.ts';
import { assertStructuredData, assertStructuredError } from '../../../helpers/structuredResult.ts';

const examplePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../src/tools/extensions/embeddable-content/contract/dataset-manifest.example.json',
);

function example(): Record<string, unknown> {
	return JSON.parse(readFileSync(examplePath, 'utf8')) as Record<string, unknown>;
}

function ctxWith(
	submit = vi.fn().mockResolvedValue({ datasetupsert: { runId: 'run-1', status: 'queued' } }),
) {
	return {
		submit,
		ctx: contextOn(createMockMwn(), { edit: { submit } as never }),
	};
}

describe('dataset-upsert', () => {
	it('unwraps an extractor envelope and forwards the manifest', async () => {
		const { submit, ctx } = ctxWith();
		const envelope = {
			manifest: example(),
			validation_report: { status: 'ok', checks: [] },
			manifest_path: '/figures/manifests/example.json',
		};

		const result = await datasetUpsert.handle({ manifest: envelope, mode: 'validate' }, ctx);

		const data = assertStructuredData(result);
		expect(data.extractorReport).toEqual({ status: 'ok', checks: [] });
		expect(submit).toHaveBeenCalledOnce();
		const call = submit.mock.calls[0][1] as Record<string, unknown>;
		expect(call.action).toBe('datasetupsert');
		expect(call.dryrun).toBe('1');
		expect(JSON.parse(call.manifest as string)).toMatchObject({ manifest_version: '1.0' });
	});

	it('forwards apply as apply=1', async () => {
		const { submit, ctx } = ctxWith();

		const result = await datasetUpsert.handle({ manifest: example(), mode: 'apply' }, ctx);

		assertStructuredData(result);
		const call = submit.mock.calls[0][1] as Record<string, unknown>;
		expect(call.apply).toBe('1');
		expect(call.dryrun).toBeUndefined();
	});

	it('reads a manifest envelope from an allowed path', async () => {
		const { submit } = ctxWith();
		const dir = mkdtempSync(join(tmpdir(), 'dataset-contract-'));
		const file = join(dir, 'manifest.json');
		writeFileSync(file, JSON.stringify({ manifest: example() }));

		const result = await datasetUpsert.handle(
			{ manifest: file, mode: 'validate' },
			contextOn(createMockMwn(), {
				edit: { submit } as never,
				uploadDirs: uploadDirsResolving(file),
			}),
		);

		assertStructuredData(result);
		expect(submit).toHaveBeenCalledOnce();
	});

	it('rejects an unknown manifest major', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		doc.manifest_version = '2.0';

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'validate' }, ctx);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects unknown top-level fields', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		doc.extra = true;

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'validate' }, ctx);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('requires the apply-only fields in apply mode', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		const table = (doc.tables as Record<string, unknown>[])[0];
		delete table.pdf_sha1;

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'apply' }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('tables[].pdf_sha1');
		expect(submit).not.toHaveBeenCalled();
	});

	it('accepts a validate run without the apply-only fields', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		delete (doc.tables as Record<string, unknown>[])[0].pdf_sha1;

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'validate' }, ctx);

		assertStructuredData(result);
		expect(submit).toHaveBeenCalledOnce();
	});

	it('rejects a manifest over the v1 cell cap', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		const table = (doc.tables as Record<string, unknown>[])[0];
		table.observations = Array.from({ length: 2_001 }, () => ({}));

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'validate' }, ctx);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects a manifest over the 1 MB cap', async () => {
		const { submit, ctx } = ctxWith();
		const doc = example();
		(doc.dataset as Record<string, unknown>).description = 'x'.repeat(1_000_001);

		const result = await datasetUpsert.handle({ manifest: doc, mode: 'validate' }, ctx);

		assertStructuredError(result, 'invalid_input');
		expect(submit).not.toHaveBeenCalled();
	});
});
