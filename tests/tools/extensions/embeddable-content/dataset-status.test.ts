import { describe, it, expect, vi } from 'vitest';
import { datasetStatus } from '../../../../src/tools/extensions/embeddable-content/dataset-status.ts';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { contextOn } from '../../../helpers/fakeContext.ts';
import { assertStructuredData } from '../../../helpers/structuredResult.ts';

describe('dataset-status', () => {
	it('forwards run_id to action=datasetstatus', async () => {
		const request = vi.fn().mockResolvedValue({
			datasetstatus: { runId: 'run-1', status: 'ok', rowCounts: { observations: 4 } },
		});
		const ctx = contextOn(createMockMwn({ request }));

		const result = await datasetStatus.handle({ run_id: 'run-1' }, ctx);

		expect(request.mock.calls[0][0]).toMatchObject({
			action: 'datasetstatus',
			run_id: 'run-1',
		});
		expect(assertStructuredData(result)).toMatchObject({
			runId: 'run-1',
			status: 'ok',
			rowCounts: { observations: 4 },
		});
	});
});
