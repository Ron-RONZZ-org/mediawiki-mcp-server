import { describe, it, expect, vi } from 'vitest';
import { createMockMwn } from '../helpers/mock-mwn.ts';
import { fakeContext } from '../helpers/fakeContext.ts';
import { getFileText } from '../../src/tools/get-file-text.ts';
import { assertStructuredError, assertStructuredSuccess } from '../helpers/structuredResult.ts';

function mwnWithPayload(payload: Record<string, unknown> | undefined) {
	return createMockMwn({
		request: vi.fn().mockResolvedValue(payload === undefined ? {} : { sourcefiletext: payload }),
	});
}

describe('get-file-text', () => {
	it('returns the extracted Markdown payload', async () => {
		const mock = mwnWithPayload({
			file: 'File:Doc.pdf',
			extractedFrom: 'File:Doc.extracted.txt',
			text: '# Abstract\n\nThe text.',
			chars: 22,
			updated: '20261121000000',
			partial: '',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileText.handle({ title: 'Doc.pdf' }, ctx);

		const text = assertStructuredSuccess(result);
		expect(text).toContain('File:Doc.pdf');
		expect(text).toContain('# Abstract');
		expect(text).toContain('File:Doc.extracted.txt');
	});

	it('marks a partial extraction', async () => {
		const mock = mwnWithPayload({
			file: 'File:Scan.pdf',
			text: 'Partial text',
			partial: '1',
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const text = assertStructuredSuccess(await getFileText.handle({ title: 'Scan.pdf' }, ctx));
		expect(text).toContain('Partial: true');
	});

	it('returns not_found when no extraction exists', async () => {
		const mock = mwnWithPayload(undefined);
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileText.handle({ title: 'Missing.pdf' }, ctx);
		const envelope = assertStructuredError(result, 'not_found');
		expect(envelope.message).toContain('No extracted text');
	});

	it('returns not_found when the API rejects', async () => {
		const mock = createMockMwn({
			request: vi.fn().mockRejectedValue(new Error('no_extracted_text')),
		});
		const ctx = fakeContext({ mwn: async () => mock as never });

		const result = await getFileText.handle({ title: 'Missing.pdf' }, ctx);
		const envelope = assertStructuredError(result, 'not_found');
		expect(envelope.message).toContain('no_extracted_text');
	});
});
