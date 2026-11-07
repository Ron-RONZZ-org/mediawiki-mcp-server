import type { ExtensionPack } from '../types.ts';
import { embeddableAddSpecialContent } from './embeddable-add-special-content.ts';
import { embeddableAddCitationSource } from './embeddable-add-citation-source.ts';
import { embeddableAddSemanticEntity } from './embeddable-add-semantic-entity.ts';
import { embeddableGetEmbedContent } from './embeddable-get-embed-content.ts';
import { embeddableDescribeEntityType } from './embeddable-describe-entity-type.ts';
import { embeddableResolveAuthors } from './embeddable-resolve-authors.ts';
import { embeddableAuthoritySearch } from './embeddable-authority-search.ts';

// `invalidentity` is shared with the WikibaseCitation API (ApiCitation returns
// the same code); declared here once so the two packs do not claim it twice.
export const embeddableContentPack: ExtensionPack = {
	id: 'embeddable',
	extensionNames: ['EmbeddableContent'],
	tools: [
		embeddableAddSpecialContent,
		embeddableAddCitationSource,
		embeddableAddSemanticEntity,
		embeddableGetEmbedContent,
		embeddableDescribeEntityType,
		embeddableResolveAuthors,
		embeddableAuthoritySearch,
	],
	errorCodes: {
		invalidentity: 'invalid_input',
	},
};
