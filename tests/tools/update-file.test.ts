import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext, contextOn, uploadDirsResolving } from '../helpers/fakeContext.ts';

import { UploadDirsImpl, type UploadDirs } from '../../src/wikis/uploadDirs.ts';
import { FILE_EXISTS, FILE_MISSING } from '../helpers/uploadingWiki.ts';
import { updateFile } from '../../src/tools/update-file.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

function ctxWith(
	opts: {
		mwn?: ReturnType<typeof createMockMwn>;
		submitUpload?: Mock;
		uploadDirs?: UploadDirs;
	} = {},
) {
	const mwn = opts.mwn ?? createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
	const submitUpload = opts.submitUpload ?? vi.fn();
	const ctx = contextOn(mwn, {
		edit: { ...baseEdit, submitUpload },
		uploadDirs: opts.uploadDirs ?? uploadDirsResolving('/var/lib/uploads/cat.jpg'),
	});
	return { mwn, submitUpload, ctx };
}

describe('update-file', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refuses a path the upload directories reject as invalid_input, skipping pre-flight and upload', async () => {
		const { mwn, submitUpload, ctx } = ctxWith({ uploadDirs: new UploadDirsImpl([]) });

		const result = await updateFile.handle(
			{
				filepath: '/etc/passwd',
				title: 'File:Shadow',
			},
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toMatch(/Failed to update file: uploads are disabled/);
		expect(mwn.request).not.toHaveBeenCalled();
		expect(submitUpload).not.toHaveBeenCalled();
	});

	it('lets unexpected path-resolution errors fall through to the dispatcher', async () => {
		const { submitUpload, ctx } = ctxWith({
			uploadDirs: {
				list: () => ['/home/user/uploads'],
				resolve: () => Promise.reject(new Error('EACCES: permission denied')),
			},
		});

		const result = await dispatch(
			updateFile,
			ctx,
		)({
			filepath: '/home/user/uploads/x.jpg',
			title: 'File:X',
		});

		assertStructuredError(result, 'upstream_failure');
		expect(submitUpload).not.toHaveBeenCalled();
	});

	it('returns not_found with routing hint when the file does not exist', async () => {
		const { submitUpload, ctx } = ctxWith({
			mwn: createMockMwn({ request: vi.fn().mockResolvedValue(FILE_MISSING) }),
		});

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
		expect(submitUpload).not.toHaveBeenCalled();
	});

	it('calls submitUpload with ignorewarnings: true and the formatted comment', async () => {
		const submitUpload = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: {
				descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg',
				url: 'https://test.wiki/images/Cat.jpg',
			},
		});
		const { mwn, ctx } = ctxWith({ submitUpload });

		await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				comment: 'New colour pass',
			},
			ctx,
		);

		expect(submitUpload).toHaveBeenCalledWith(
			mwn,
			'/var/lib/uploads/cat.jpg',
			'File:Cat.jpg',
			'',
			expect.objectContaining({
				ignorewarnings: true,
				comment: expect.stringMatching(/^New colour pass.*update-file/),
			}),
		);
	});

	it('returns the same structured payload as upload-file on success', async () => {
		const submitUpload = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: {
				descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg',
				url: 'https://test.wiki/images/Cat.jpg',
			},
		});
		const { ctx } = ctxWith({ submitUpload });

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
		const submitUpload = vi.fn().mockRejectedValue(new Error('Boom'));
		const { ctx } = ctxWith({ submitUpload });

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
		const err = Object.assign(new Error('You cannot reupload'), { code: 'permissiondenied' });
		const submitUpload = vi.fn().mockRejectedValue(err);
		const { ctx } = ctxWith({ submitUpload });

		const result = await dispatch(
			updateFile,
			ctx,
		)({
			filepath: '/home/user/uploads/cat.jpg',
			title: 'File:Cat.jpg',
		});

		assertStructuredError(result, 'permission_denied');
	});

	it('updates semantic image facts with mode=update', async () => {
		const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
		const submitUpload = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: { descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg' },
		});
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const ctx = contextOn(mwn, {
			edit: { ...baseEdit, submitUpload, submit },
			uploadDirs: uploadDirsResolving('/var/lib/uploads/cat.jpg'),
		});

		const result = await updateFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				license: 'Q124',
				author: 'NASA',
			},
			ctx,
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
		const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
		const submitUpload = vi.fn().mockResolvedValue({ result: 'Success' });
		const submit = vi.fn();
		const ctx = contextOn(mwn, {
			edit: { ...baseEdit, submitUpload, submit },
			uploadDirs: uploadDirsResolving('/var/lib/uploads/cat.jpg'),
		});

		await updateFile.handle({ filepath: '/home/user/uploads/cat.jpg', title: 'File:Cat.jpg' }, ctx);

		expect(submit).not.toHaveBeenCalled();
	});

	it('factsOnly updates facts without touching filepath or uploading bytes', async () => {
		const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
		const submitUpload = vi.fn();
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const ctx = contextOn(mwn, { edit: { ...baseEdit, submitUpload, submit } });

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
		expect(submitUpload).not.toHaveBeenCalled();
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
		const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
		const submit = vi.fn();
		const ctx = contextOn(mwn, { edit: { ...baseEdit, submitUpload: vi.fn(), submit } });

		const result = await updateFile.handle({ title: 'File:Cat.jpg', factsOnly: true }, ctx);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toContain('at least one fact field or clear entry');
		expect(submit).not.toHaveBeenCalled();
	});

	it('sends an explicit clear list with mode=update', async () => {
		const mwn = createMockMwn({ request: vi.fn().mockResolvedValue(FILE_EXISTS) });
		const submitUpload = vi.fn();
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const ctx = contextOn(mwn, { edit: { ...baseEdit, submitUpload, submit } });

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
		expect(submitUpload).not.toHaveBeenCalled();
	});
});
