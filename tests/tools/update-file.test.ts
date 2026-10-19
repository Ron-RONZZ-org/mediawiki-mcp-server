import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext } from '../helpers/fakeContext.ts';

vi.mock('../../src/transport/uploadGuard.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/transport/uploadGuard.ts')>(
		'../../src/transport/uploadGuard.ts',
	);
	return {
		...actual,
		assertAllowedPath: vi.fn(),
	};
});

vi.mock('../../src/transport/fileExistence.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/transport/fileExistence.ts')>(
		'../../src/transport/fileExistence.ts',
	);
	return {
		...actual,
		assertFileExists: vi.fn(),
	};
});

vi.mock('../../src/transport/uploadBytes.ts', () => ({
	readUploadBytes: vi.fn(),
}));

import { assertAllowedPath, UploadValidationError } from '../../src/transport/uploadGuard.ts';
import { readUploadBytes } from '../../src/transport/uploadBytes.ts';
import { assertFileExists, FileNotFoundError } from '../../src/transport/fileExistence.ts';
import { updateFile } from '../../src/tools/update-file.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

function ctxWith(
	opts: {
		mwn?: ReturnType<typeof createMockMwn>;
		submitUploadFromBytes?: Mock;
	} = {},
) {
	const mwn = opts.mwn ?? createMockMwn();
	const submitUploadFromBytes = opts.submitUploadFromBytes ?? vi.fn();
	const ctx = fakeContext({
		mwn: async () => mwn as never,
		edit: { ...baseEdit, submitUploadFromBytes },
		uploadDirs: { list: () => ['/home/user/uploads'] },
	});
	return { mwn, submitUploadFromBytes, ctx };
}

describe('update-file', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(readUploadBytes).mockResolvedValue(Buffer.from('cat-bytes'));
	});

	it('returns invalid_input for UploadValidationError, skips pre-flight and upload', async () => {
		vi.mocked(assertAllowedPath).mockRejectedValue(
			new UploadValidationError('"/etc/passwd" is not allowed'),
		);
		const { submitUploadFromBytes, ctx } = ctxWith();

		const result = await updateFile.handle(
			{
				filepath: '/etc/passwd',
				title: 'File:Shadow',
			},
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toMatch(/Failed to update file:.*not allowed/);
		expect(assertFileExists).not.toHaveBeenCalled();
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
	});

	it('lets unexpected guard errors fall through to the dispatcher', async () => {
		vi.mocked(assertAllowedPath).mockRejectedValue(new Error('Connection refused'));
		const { submitUploadFromBytes, ctx } = ctxWith();

		const result = await dispatch(
			updateFile,
			ctx,
		)({
			filepath: '/home/user/uploads/x.jpg',
			title: 'File:X',
		});

		assertStructuredError(result, 'upstream_failure');
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
	});

	it('returns not_found with routing hint when the file does not exist', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockRejectedValue(new FileNotFoundError('Cat.jpg'));
		const { submitUploadFromBytes, ctx } = ctxWith();

		const result = await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'Cat.jpg',
			},
			ctx,
		);

		const envelope = assertStructuredError(result, 'not_found');
		expect(envelope.message).toMatch(/Cat\.jpg/);
		expect(envelope.message).toMatch(/upload-file\b/);
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
	});

	it('calls submitUploadFromBytes with ignorewarnings: true and the formatted comment', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: {
				descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg',
				url: 'https://test.wiki/images/Cat.jpg',
			},
		});
		const { mwn, ctx } = ctxWith({ submitUploadFromBytes });

		await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				comment: 'New colour pass',
			},
			ctx,
		);

		expect(submitUploadFromBytes).toHaveBeenCalledWith(
			mwn,
			Buffer.from('cat-bytes'),
			'Cat.jpg',
			'File:Cat.jpg',
			'',
			expect.objectContaining({
				ignorewarnings: true,
				comment: expect.stringMatching(/^New colour pass.*update-file/),
			}),
		);
	});

	it('returns the same structured payload as upload-file on success', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: {
				descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg',
				url: 'https://test.wiki/images/Cat.jpg',
			},
		});
		const { ctx } = ctxWith({ submitUploadFromBytes });

		const result = await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
			},
			ctx,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Filename: Cat.jpg');
		expect(text).toContain('Page URL: https://test.wiki/wiki/File:Cat.jpg');
		expect(text).toContain('File URL: https://test.wiki/images/Cat.jpg');
	});

	it('dispatches generic upstream errors with the standard verb prefix', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockRejectedValue(new Error('Boom'));
		const { ctx } = ctxWith({ submitUploadFromBytes });

		const result = await dispatch(
			updateFile,
			ctx,
		)({
			filepath: '/home/user/uploads/cat.jpg',
			title: 'File:Cat.jpg',
		});

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toMatch(/Failed to update file: Boom/);
	});

	it('maps permissiondenied-coded errors to permission_denied', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const err = Object.assign(new Error('You cannot reupload'), { code: 'permissiondenied' });
		const submitUploadFromBytes = vi.fn().mockRejectedValue(err);
		const { ctx } = ctxWith({ submitUploadFromBytes });

		const result = await dispatch(
			updateFile,
			ctx,
		)({
			filepath: '/home/user/uploads/cat.jpg',
			title: 'File:Cat.jpg',
		});

		assertStructuredError(result, 'permission_denied');
	});

	it('forwards ctx.uploadDirs.list() to the path guard', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/home/user/uploads/x.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockResolvedValue({ result: 'Success' });
		const { ctx } = ctxWith({ submitUploadFromBytes });

		await updateFile.handle(
			{
				filepath: '/home/user/uploads/x.jpg',
				title: 'File:X',
			},
			ctx,
		);

		expect(assertAllowedPath).toHaveBeenCalledWith('/home/user/uploads/x.jpg', [
			'/home/user/uploads',
		]);
	});

	it('updates semantic image facts with mode=update', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: { descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg' },
		});
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const { mwn } = ctxWith({ submitUploadFromBytes });
		const ctxWithFacts = fakeContext({
			mwn: async () => mwn as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				license: 'Q124',
				author: 'NASA',
			},
			ctxWithFacts,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Image item ID: Q999');
		expect(submit).toHaveBeenCalledWith(
			mwn,
			expect.objectContaining({
				action: 'imagefacts',
				filename: 'File:Cat.jpg',
				mode: 'update',
				license: 'Q124',
				author: 'NASA',
			}),
		);
	});

	it('does not call imagefacts when updating without facts', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn().mockResolvedValue({ result: 'Success' });
		const submit = vi.fn();
		const { mwn } = ctxWith({ submitUploadFromBytes });
		const ctxWithSubmit = fakeContext({
			mwn: async () => mwn as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		await updateFile.handle(
			{ filepath: '/home/user/uploads/cat.jpg', title: 'File:Cat.jpg' },
			ctxWithSubmit,
		);

		expect(submit).not.toHaveBeenCalled();
	});

	it('factsOnly updates facts without touching filepath or uploading bytes', async () => {
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn();
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const mwn = createMockMwn();
		const ctx = fakeContext({
			mwn: async () => mwn as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
		});

		const result = await updateFile.handle(
			{
				title: 'File:Cat.jpg',
				factsOnly: true,
				license: 'Q319',
				author: 'Author D',
			},
			ctx,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Image item ID: Q999');
		expect(text).toContain('Facts only: true');
		expect(assertAllowedPath).not.toHaveBeenCalled();
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
		expect(submit).toHaveBeenCalledWith(
			mwn,
			expect.objectContaining({
				action: 'imagefacts',
				filename: 'File:Cat.jpg',
				mode: 'update',
				license: 'Q319',
				author: 'Author D',
			}),
		);
	});

	it('factsOnly rejects a call with no facts and no clear list', async () => {
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submit = vi.fn();
		const ctx = fakeContext({
			mwn: async () => createMockMwn() as never,
			edit: { ...baseEdit, submitUploadFromBytes: vi.fn(), submit },
		});

		const result = await updateFile.handle({ title: 'File:Cat.jpg', factsOnly: true }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('at least one fact field or clear entry');
		expect(submit).not.toHaveBeenCalled();
	});

	it('sends an explicit clear list with mode=update', async () => {
		vi.mocked(assertFileExists).mockResolvedValue(undefined);
		const submitUploadFromBytes = vi.fn();
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const mwn = createMockMwn();
		const ctx = fakeContext({
			mwn: async () => mwn as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
		});

		await updateFile.handle(
			{ title: 'File:Cat.jpg', factsOnly: true, clear: ['licenseInfo', 'sourceUrl'] },
			ctx,
		);

		expect(submit).toHaveBeenCalledWith(
			mwn,
			expect.objectContaining({
				action: 'imagefacts',
				mode: 'update',
				clear: 'licenseInfo,sourceUrl',
			}),
		);
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
	});
});
