import type { ExtensionPack } from '../types.ts';
import { embeddableAddSpecialContent } from './embeddable-add-special-content.ts';
import { embeddableAddCitationSource } from './embeddable-add-citation-source.ts';
import { embeddableAddSemanticEntity } from './embeddable-add-semantic-entity.ts';
import { embeddableGetEmbedContent } from './embeddable-get-embed-content.ts';
import { embeddableDescribeEntityType } from './embeddable-describe-entity-type.ts';
import { embeddableResolveAuthors } from './embeddable-resolve-authors.ts';
import { embeddableAuthoritySearch } from './embeddable-authority-search.ts';
import { datasetUpsert } from './dataset-upsert.ts';
import { datasetQuery } from './dataset-query.ts';
import { datasetStatus } from './dataset-status.ts';

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
		datasetUpsert,
		datasetQuery,
		datasetStatus,
	],
	errorCodes: {
		invalidentity: 'invalid_input',
		'manifest-invalid': 'invalid_input',
		'referential-integrity': 'invalid_input',
		'pdf-provenance': 'invalid_input',
		'page-conflict': 'conflict',
		'page-too-large': 'invalid_input',
		'schema-mismatch': 'upstream_failure',
		'store-error': 'upstream_failure',
		'wikibase-write': 'upstream_failure',
		'size-limit': 'invalid_input',
	},
};
