import type { ExtensionPack } from '../types.ts';
import { citationGetCitation } from './citation-get-citation.ts';

export const wikibaseCitationPack: ExtensionPack = {
	id: 'citation',
	extensionNames: ['WikibaseCitation'],
	tools: [citationGetCitation],
	// `invalidentity` (shared with the EmbeddableContent API) is declared on the
	// embeddable-content pack; declaring it here too would fail startup.
	errorCodes: {
		entitynotfound: 'not_found',
	},
};
