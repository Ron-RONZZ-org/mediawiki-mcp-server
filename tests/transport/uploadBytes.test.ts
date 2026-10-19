import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
	stat: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock('../../src/transport/httpFetch.ts', () => ({
	resolveUploadMaxBytes: vi.fn(),
}));

import { readFile, stat } from 'node:fs/promises';
import { resolveUploadMaxBytes } from '../../src/transport/httpFetch.ts';
import { readUploadBytes } from '../../src/transport/uploadBytes.ts';
import { UploadValidationError } from '../../src/transport/uploadGuard.ts';

describe('readUploadBytes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reads the file when it is under the operator limit', async () => {
		vi.mocked(resolveUploadMaxBytes).mockReturnValue(10);
		vi.mocked(stat).mockResolvedValue({ size: 3 } as never);
		vi.mocked(readFile).mockResolvedValue(Buffer.from('abc'));

		await expect(readUploadBytes('/uploads/x.svg')).resolves.toEqual(Buffer.from('abc'));
		expect(stat).toHaveBeenCalledWith('/uploads/x.svg');
		expect(readFile).toHaveBeenCalledWith('/uploads/x.svg');
	});

	it('rejects an over-limit file before reading it into memory', async () => {
		vi.mocked(resolveUploadMaxBytes).mockReturnValue(4);
		vi.mocked(stat).mockResolvedValue({ size: 5 } as never);

		await expect(readUploadBytes('/uploads/big.svg')).rejects.toBeInstanceOf(UploadValidationError);
		await expect(readUploadBytes('/uploads/big.svg')).rejects.toThrow(/MCP_UPLOAD_MAX_BYTES/);
		expect(readFile).not.toHaveBeenCalled();
	});
});
