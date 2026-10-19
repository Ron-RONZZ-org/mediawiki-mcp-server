import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { createMockMwnError } from '../helpers/mock-mwn-error.ts';
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

vi.mock('../../src/transport/uploadBytes.ts', () => ({
	readUploadBytes: vi.fn(),
}));

import { assertAllowedPath, UploadValidationError } from '../../src/transport/uploadGuard.ts';
import { readUploadBytes } from '../../src/transport/uploadBytes.ts';
import { uploadFile } from '../../src/tools/upload-file.ts';
import { dispatch } from '../../src/runtime/dispatcher.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

// fakeContext's edit slice throws on any method a test leaves unstubbed.
const baseEdit = fakeContext().edit;

describe('upload-file', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(readUploadBytes).mockResolvedValue(Buffer.from('cat-bytes'));
	});

	it('categorises UploadValidationError as invalid_input and does not call the upload', async () => {
		vi.mocked(assertAllowedPath).mockRejectedValue(
			new UploadValidationError(
				'"/etc/passwd" is not allowed by the configured upload directories.',
			),
		);
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi.fn();
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await uploadFile.handle(
			{
				filepath: '/etc/passwd',
				title: 'File:Shadow',
				text: 'body',
			},
			ctx,
		);

		const envelope = assertStructuredError(result, 'invalid_input');
		expect(envelope.message).toMatch(/Failed to upload file:.*not allowed/);
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
		expect(readUploadBytes).not.toHaveBeenCalled();
	});

	it('lets unexpected guard errors fall through to the dispatcher', async () => {
		vi.mocked(assertAllowedPath).mockRejectedValue(new Error('Connection refused'));
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi.fn();
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await dispatch(
			uploadFile,
			ctx,
		)({
			filepath: '/home/user/uploads/x.jpg',
			title: 'File:X',
			text: 'body',
		});

		const envelope = assertStructuredError(result, 'upstream_failure');
		expect(envelope.message).toMatch(/Failed to upload file: Connection refused/);
		expect(submitUploadFromBytes).not.toHaveBeenCalled();
	});

	it('returns a structured payload on success and routes through ctx.edit.submitUploadFromBytes', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: {
				descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg',
				url: 'https://test.wiki/images/Cat.jpg',
			},
		});
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await uploadFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				text: 'A cat.',
			},
			ctx,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Filename: Cat.jpg');
		expect(text).toContain('Page URL: https://test.wiki/wiki/File:Cat.jpg');
		expect(text).toContain('File URL: https://test.wiki/images/Cat.jpg');

		expect(submitUploadFromBytes).toHaveBeenCalledWith(
			mock,
			Buffer.from('cat-bytes'),
			'Cat.jpg',
			'File:Cat.jpg',
			'A cat.',
			expect.objectContaining({
				comment: expect.stringContaining('upload-file'),
			}),
		);
	});

	it('passes ctx.uploadDirs.list() to the path guard', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/home/user/uploads/x.jpg');
		const mock = createMockMwn();
		const submitUploadFromBytes = vi.fn().mockResolvedValue({ result: 'Success' });
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		await uploadFile.handle(
			{
				filepath: '/home/user/uploads/x.jpg',
				title: 'File:X',
				text: 'body',
			},
			ctx,
		);

		expect(assertAllowedPath).toHaveBeenCalledWith('/home/user/uploads/x.jpg', [
			'/home/user/uploads',
		]);
	});

	it('attaches semantic image facts and returns the item id', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi.fn().mockResolvedValue({
			result: 'Success',
			filename: 'Cat.jpg',
			imageinfo: { descriptionurl: 'https://test.wiki/wiki/File:Cat.jpg' },
		});
		const submit = vi.fn().mockResolvedValue({ imagefacts: { itemId: 'Q999' } });
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await uploadFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				text: 'A cat.',
				description: 'A cat photo.',
				license: 'Q124',
				author: 'NASA',
				licenseInfo: 'Public domain, modified.',
				sourceUrl: 'https://source.example/cat.jpg',
			},
			ctx,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Image item ID: Q999');
		expect(submit).toHaveBeenCalledWith(
			mock,
			expect.objectContaining({
				action: 'imagefacts',
				filename: 'File:Cat.jpg',
				description: 'A cat photo.',
				license: 'Q124',
				author: 'NASA',
				licenseInfo: 'Public domain, modified.',
				sourceUrl: 'https://source.example/cat.jpg',
			}),
		);
	});

	it('does not call imagefacts when no facts are supplied', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi.fn().mockResolvedValue({ result: 'Success' });
		const submit = vi.fn();
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		await uploadFile.handle(
			{ filepath: '/home/user/uploads/cat.jpg', title: 'File:Cat.jpg', text: 'A cat.' },
			ctx,
		);

		expect(submit).not.toHaveBeenCalled();
	});

	it('reports a warning when the wiki has no imagefacts action', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi
			.fn()
			.mockResolvedValue({ result: 'Success', filename: 'Cat.jpg' });
		const submit = vi
			.fn()
			.mockRejectedValue(
				createMockMwnError('badvalue', 'Unrecognized value for parameter "action": imagefacts.'),
			);
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await uploadFile.handle(
			{
				filepath: '/home/user/uploads/cat.jpg',
				title: 'File:Cat.jpg',
				text: 'A cat.',
				license: 'Q124',
			},
			ctx,
		);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('Image facts warning');
		expect(text).toContain('no image-facts API');
	});

	it('reports the successful upload when attaching facts fails', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn({ upload: vi.fn() });
		const submitUploadFromBytes = vi
			.fn()
			.mockResolvedValue({ result: 'Success', filename: 'Cat.jpg' });
		const submit = vi.fn().mockRejectedValue(createMockMwnError('permissiondenied'));
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes, submit },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await dispatch(
			uploadFile,
			ctx,
		)({
			filepath: '/home/user/uploads/cat.jpg',
			title: 'File:Cat.jpg',
			text: 'A cat.',
			license: 'Q124',
		});

		const envelope = assertStructuredError(result, 'permission_denied');
		expect(envelope.message).toContain('uploaded as File:Cat.jpg');
		expect(envelope.message).toContain('attaching image facts failed');
	});

	it('dispatches permissiondenied as permission_denied via dispatcher', async () => {
		vi.mocked(assertAllowedPath).mockResolvedValue('/var/lib/uploads/cat.jpg');
		const mock = createMockMwn();
		const submitUploadFromBytes = vi.fn().mockRejectedValue(createMockMwnError('permissiondenied'));
		const ctx = fakeContext({
			mwn: async () => mock as never,
			edit: { ...baseEdit, submitUploadFromBytes },
			uploadDirs: { list: () => ['/home/user/uploads'] },
		});

		const result = await dispatch(
			uploadFile,
			ctx,
		)({
			filepath: '/home/user/uploads/cat.jpg',
			title: 'File:Cat.jpg',
			text: 'A cat.',
		});

		assertStructuredError(result, 'permission_denied', 'permissiondenied');
	});
});
