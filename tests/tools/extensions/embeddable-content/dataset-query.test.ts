import { describe, it, expect, vi } from 'vitest';
import { datasetQuery } from '../../../../src/tools/extensions/embeddable-content/dataset-query.ts';
import { createMockMwn } from '../../../helpers/mock-mwn.ts';
import { contextOn } from '../../../helpers/fakeContext.ts';
import { assertStructuredData } from '../../../helpers/structuredResult.ts';

describe('dataset-query', () => {
	it('forwards filters and pagination to action=datasetquery', async () => {
		const request = vi.fn().mockResolvedValue({
			datasetquery: { rows: [{ table_id: 'example-2026-t1' }], total: 1 },
		});
		const ctx = contextOn(createMockMwn({ request }));

		const result = await datasetQuery.handle(
			{
				dataset_id: 'example-2026',
				table_id: 'example-2026-t1',
				panel_key: 'p1',
				column_key: 'd',
				search: 'coactor',
				order: 'row_index',
				limit: 10,
				offset: 0,
				format: 'json',
			},
			ctx,
		);

		const call = request.mock.calls[0][0] as Record<string, unknown>;
		expect(call).toMatchObject({
			action: 'datasetquery',
			dataset_id: 'example-2026',
			table_id: 'example-2026-t1',
			panel_key: 'p1',
			column_key: 'd',
			search: 'coactor',
			order: 'row_index',
			limit: 10,
			offset: 0,
			format: 'json',
		});
		expect(assertStructuredData(result).rows).toEqual([{ table_id: 'example-2026-t1' }]);
	});

	it('returns csv text unchanged', async () => {
		const rawRequest = vi.fn().mockResolvedValue({ data: 'row_index,value\n1,0.42\n' });
		const ctx = contextOn(createMockMwn({ rawRequest }));

		const result = await datasetQuery.handle(
			{ dataset_id: 'example-2026', limit: 500, offset: 0, format: 'csv' },
			ctx,
		);

		expect(assertStructuredData(result)).toMatchObject({
			format: 'csv',
			text: 'row_index,value\n1,0.42\n',
		});
	});
});
