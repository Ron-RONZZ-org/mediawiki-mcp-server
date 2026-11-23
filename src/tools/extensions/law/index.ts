import type { ExtensionPack } from '../types.ts';
import { lawSearch } from './law-search.ts';
import { lawGet } from './law-get.ts';
import { lawCite } from './law-cite.ts';

/**
 * The law-corpus pack: search/read/cite over Special:Law. It runs on a wiki
 * with the EmbeddableContent extension (the `action=law*` modules live there);
 * it is separate from the embeddable pack so its tool names keep the `law-`
 * prefix and the citation agent can be given only this surface.
 */
export const lawPack: ExtensionPack = {
	id: 'law',
	extensionNames: ['EmbeddableContent'],
	tools: [lawSearch, lawGet, lawCite],
	errorCodes: {
		'law-not-found': 'not_found',
		'article-not-found': 'not_found',
		'item-create-failed': 'upstream_failure',
	},
};
