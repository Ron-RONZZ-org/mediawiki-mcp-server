import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Tool } from '../../../runtime/tool.ts';
import type { ToolContext } from '../../../runtime/context.ts';

const inputSchema = {
	run_id: z
		.string()
		.min(1)
		.describe('The run_id returned by embeddable-dataset-upsert in apply mode.'),
} as const;

export const datasetStatus: Tool<typeof inputSchema> = {
	name: 'embeddable-dataset-status',
	description:
		"Returns the state of a queued datasetApply job through the wiki's action=datasetstatus: status (ok, partial, failed, queued, running), the page title and revision, item IDs, row counts, warnings and the validation report. Use it after embeddable-dataset-upsert with mode='apply'.",
	inputSchema,
	annotations: {
		title: 'Read a dataset apply run',
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	failureVerb: 'read the dataset run status',
	target: (a) => a.run_id,

	async handle({ run_id }, ctx: ToolContext): Promise<CallToolResult> {
		const mwn = await ctx.mwn();
		const raw = await mwn.request({ action: 'datasetstatus', run_id });
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action=datasetstatus response shape; trusted at this boundary
		const response = raw as { datasetstatus?: Record<string, unknown> };
		return ctx.format.ok(response.datasetstatus ?? { runId: run_id, status: 'unknown' });
	},
};
