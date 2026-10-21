import { getFileInfo } from './get-file-info.ts';

/**
 * @deprecated Use `get-file-info`. Kept as a compatibility alias so existing
 * prompts and clients keep working while they migrate.
 */
export const getFile = {
	...getFileInfo,
	name: 'get-file',
	description: `Deprecated: use get-file-info. ${getFileInfo.description}`,
	annotations: {
		...getFileInfo.annotations,
		title: 'Get file (deprecated)',
	},
};
