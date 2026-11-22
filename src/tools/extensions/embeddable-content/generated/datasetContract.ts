// AUTO-GENERATED — do not edit by hand.
//
// Source: contract/dataset-manifest.schema.json + contract/dataset-store-fields.json,
// emitted by the ronzz-wikibase EmbeddableContent extension
// (maintenance/emitDatasetContract.php). Refresh the pinned files first, then:
//
//   npm run gen:dataset-contract

export const DATASET_MANIFEST_VERSION = '1.0' as const;
export const DATASET_MANIFEST_TOP_LEVEL_KEYS = ['manifest_version', 'dataset', 'tables'] as const;
export const DATASET_ACCESS_TIERS = ['public', 'registered', 'internal'] as const;
export const DATASET_STATUSES = ['draft', 'reviewed', 'published', 'archived'] as const;
export const DATASET_COLUMN_DATATYPES = ['integer', 'float', 'text', 'date', 'boolean'] as const;
export const DATASET_COLUMN_ROLES = ['dimension', 'measure', 'flag', 'note'] as const;
export const DATASET_FOOTNOTE_SCOPES = ['table', 'column', 'cell'] as const;
export const DATASET_FOOTNOTE_STATUSES = ['matched', 'missing_note', 'orphan_note'] as const;
export const DATASET_RUN_STATUSES = ['ok', 'needs_review', 'failed'] as const;
export const DATASET_METHODS = ['text-layer', 'ocr', 'vision', 'manual'] as const;
export const DATASET_REVIEW_STATUSES = ['unreviewed', 'checked', 'verified'] as const;
export const DATASET_SOURCE_FILE_ACCESS = ['public', 'internal'] as const;
export const DATASET_ERROR_CODES = [
	'manifest-invalid',
	'referential-integrity',
	'pdf-provenance',
	'page-conflict',
	'page-too-large',
	'schema-mismatch',
	'store-error',
	'wikibase-write',
	'permission',
	'size-limit',
] as const;

export type DatasetStoreField = {
	store: string;
	requiredFor: readonly ('validate' | 'apply')[];
	generatedIfMissing?: boolean;
};

export const DATASET_STORE_FIELDS = {
	manifest_version: { store: 'datasets.manifest_version', requiredFor: ['validate', 'apply'] },
	'dataset.dataset_id': { store: 'datasets.dataset_id', requiredFor: ['validate', 'apply'] },
	'dataset.title': { store: 'datasets.title', requiredFor: ['validate', 'apply'] },
	'dataset.description': { store: 'datasets.description', requiredFor: [] },
	'dataset.source_page': { store: 'datasets.source_page', requiredFor: ['apply'] },
	'dataset.source_item': { store: 'datasets.source_item', requiredFor: ['apply'] },
	'dataset.doi': { store: 'datasets.doi', requiredFor: [] },
	'dataset.year': { store: 'datasets.year', requiredFor: [] },
	'dataset.licence': { store: 'datasets.licence', requiredFor: [] },
	'dataset.licence_label': { store: 'datasets.licence_label', requiredFor: [] },
	'dataset.rights_basis': { store: 'datasets.rights_basis', requiredFor: [] },
	'dataset.rights_basis_label': { store: 'datasets.rights_basis_label', requiredFor: [] },
	'dataset.access_tier': { store: 'datasets.access_tier', requiredFor: ['validate', 'apply'] },
	'dataset.curator': { store: 'datasets.curator', requiredFor: [] },
	'dataset.status': { store: 'datasets.status', requiredFor: [] },
	'tables[].table_id': { store: 'data_tables.table_id', requiredFor: [], generatedIfMissing: true },
	'tables[].table_number': {
		store: 'data_tables.table_number',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].caption': { store: 'data_tables.caption', requiredFor: ['validate', 'apply'] },
	'tables[].page': { store: 'data_tables.page', requiredFor: ['validate', 'apply'] },
	'tables[].page_start': { store: 'data_tables.page_start', requiredFor: [] },
	'tables[].page_end': { store: 'data_tables.page_end', requiredFor: [] },
	'tables[].table_bbox': { store: 'data_tables.table_bbox', requiredFor: [] },
	'tables[].caption_bbox': { store: 'data_tables.caption_bbox', requiredFor: [] },
	'tables[].source_index': { store: 'data_tables.source_index', requiredFor: [] },
	'tables[].pdf_file': { store: 'data_tables.pdf_file', requiredFor: ['apply'] },
	'tables[].pdf_sha1': { store: 'data_tables.pdf_sha1', requiredFor: ['apply'] },
	'tables[].pdf_revision': { store: 'data_tables.pdf_revision', requiredFor: [] },
	'tables[].source_file_access': { store: 'data_tables.source_file_access', requiredFor: [] },
	'tables[].extractor': { store: 'data_tables.extractor', requiredFor: ['apply'] },
	'tables[].extractor_version': { store: 'data_tables.extractor_version', requiredFor: ['apply'] },
	'tables[].method': { store: 'data_tables.method', requiredFor: ['apply'] },
	'tables[].confidence': { store: 'data_tables.confidence', requiredFor: [] },
	'tables[].review_status': { store: 'data_tables.review_status', requiredFor: [] },
	'tables[].reviewer': { store: 'data_tables.reviewer', requiredFor: [] },
	'tables[].review_date': { store: 'data_tables.review_date', requiredFor: [] },
	'tables[].notes': { store: 'data_tables.notes', requiredFor: [] },
	'tables[].panels[].panel_key': { store: 'panels.panel_key', requiredFor: ['validate', 'apply'] },
	'tables[].panels[].panel_label': { store: 'panels.panel_label', requiredFor: [] },
	'tables[].panels[].panel_order': { store: 'panels.panel_order', requiredFor: [] },
	'tables[].panels[].description': { store: 'panels.description', requiredFor: [] },
	'tables[].columns[].panel_key': { store: 'data_columns.panel_key', requiredFor: [] },
	'tables[].columns[].column_key': {
		store: 'data_columns.column_key',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].columns[].label': { store: 'data_columns.label', requiredFor: ['validate', 'apply'] },
	'tables[].columns[].description': { store: 'data_columns.description', requiredFor: [] },
	'tables[].columns[].unit': { store: 'data_columns.unit', requiredFor: [] },
	'tables[].columns[].datatype': {
		store: 'data_columns.datatype',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].columns[].role': { store: 'data_columns.role', requiredFor: ['validate', 'apply'] },
	'tables[].columns[].missing_token': { store: 'data_columns.missing_token', requiredFor: [] },
	'tables[].columns[].sort_order': { store: 'data_columns.sort_order', requiredFor: [] },
	'tables[].columns[].column_parent_key': {
		store: 'data_columns.column_parent_key',
		requiredFor: [],
	},
	'tables[].columns[].column_level': { store: 'data_columns.column_level', requiredFor: [] },
	'tables[].observations[].panel_key': { store: 'observations.panel_key', requiredFor: [] },
	'tables[].observations[].row_index': {
		store: 'observations.row_index',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].observations[].row_key': {
		store: 'observations.row_key',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].observations[].row_label': {
		store: 'observations.row_label',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].observations[].row_path': { store: 'observations.row_path', requiredFor: [] },
	'tables[].observations[].row_parent_key': {
		store: 'observations.row_parent_key',
		requiredFor: [],
	},
	'tables[].observations[].row_depth': { store: 'observations.row_depth', requiredFor: [] },
	'tables[].observations[].column_key': {
		store: 'observations.column_key',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].observations[].value_float': { store: 'observations.value_float', requiredFor: [] },
	'tables[].observations[].value_int': { store: 'observations.value_int', requiredFor: [] },
	'tables[].observations[].value_text': { store: 'observations.value_text', requiredFor: [] },
	'tables[].observations[].value_date': { store: 'observations.value_date', requiredFor: [] },
	'tables[].observations[].flag_significant': {
		store: 'observations.flag_significant',
		requiredFor: [],
	},
	'tables[].observations[].flag_note': { store: 'observations.flag_note', requiredFor: [] },
	'tables[].observations[].footnote_keys': { store: 'observations.footnote_keys', requiredFor: [] },
	'tables[].observations[].source_page': { store: 'observations.source_page', requiredFor: [] },
	'tables[].observations[].cell_bbox': { store: 'observations.cell_bbox', requiredFor: [] },
	'tables[].footnotes[].footnote_key': {
		store: 'footnotes.footnote_key',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].footnotes[].marker_raw': { store: 'footnotes.marker_raw', requiredFor: [] },
	'tables[].footnotes[].text': { store: 'footnotes.text', requiredFor: ['validate', 'apply'] },
	'tables[].footnotes[].scope': { store: 'footnotes.scope', requiredFor: ['validate', 'apply'] },
	'tables[].footnotes[].language': { store: 'footnotes.language', requiredFor: [] },
	'tables[].footnotes[].sort_order': { store: 'footnotes.sort_order', requiredFor: [] },
	'tables[].footnotes[].status': { store: 'footnotes.status', requiredFor: [] },
	'tables[].extraction_runs[].run_id': {
		store: 'extraction_runs.run_id',
		requiredFor: ['validate', 'apply'],
	},
	'tables[].extraction_runs[].tool': { store: 'extraction_runs.tool', requiredFor: ['apply'] },
	'tables[].extraction_runs[].tool_version': {
		store: 'extraction_runs.tool_version',
		requiredFor: ['apply'],
	},
	'tables[].extraction_runs[].model': { store: 'extraction_runs.model', requiredFor: [] },
	'tables[].extraction_runs[].prompt_version': {
		store: 'extraction_runs.prompt_version',
		requiredFor: [],
	},
	'tables[].extraction_runs[].started_at': { store: 'extraction_runs.started_at', requiredFor: [] },
	'tables[].extraction_runs[].finished_at': {
		store: 'extraction_runs.finished_at',
		requiredFor: [],
	},
	'tables[].extraction_runs[].status': { store: 'extraction_runs.status', requiredFor: [] },
	'tables[].extraction_runs[].confidence': { store: 'extraction_runs.confidence', requiredFor: [] },
	'tables[].extraction_runs[].report_json': {
		store: 'extraction_runs.report_json',
		requiredFor: [],
	},
	'tables[].extraction_runs[].diff_json': { store: 'extraction_runs.diff_json', requiredFor: [] },
} as const satisfies Record<string, DatasetStoreField>;

export const DATASET_GENERATED_FIELDS = {
	'datasets.search_text': 'dataset.title, dataset.description, dataset.source_page, dataset.doi',
	'datasets.manifest_hash': 'sha256(manifest)',
	'datasets.manifest_revision': 'saved manifest page revision',
	'datasets.created_at': 'now',
	'datasets.updated_at': 'now',
	'data_tables.dataset_id': 'dataset.dataset_id',
	'data_tables.search_text': 'tables[].caption, tables[].notes',
	'data_tables.created_at': 'now',
	'data_tables.updated_at': 'now',
	'panels.panel_id': 'table_id + panel_key',
	'panels.table_id': 'tables[].table_id',
	'data_columns.column_id': 'table_id + panel_key + column_key',
	'data_columns.table_id': 'tables[].table_id',
	'data_columns.search_text': 'tables[].columns[].label, description, unit',
	'observations.obs_id': 'table_id + row_index + panel_key + column_key',
	'observations.table_id': 'tables[].table_id',
	'observations.search_text': 'row_label, value_text',
	'footnotes.footnote_id': 'table_id + footnote_key',
	'footnotes.table_id': 'tables[].table_id',
	'footnotes.search_text': 'tables[].footnotes[].text',
	'extraction_runs.table_id': 'tables[].table_id',
} as const;

export const DATASET_REQUIRED_FOR_VALIDATE = [
	'manifest_version',
	'dataset.dataset_id',
	'dataset.title',
	'dataset.access_tier',
	'tables[].table_number',
	'tables[].caption',
	'tables[].page',
	'tables[].panels[].panel_key',
	'tables[].columns[].column_key',
	'tables[].columns[].label',
	'tables[].columns[].datatype',
	'tables[].columns[].role',
	'tables[].observations[].row_index',
	'tables[].observations[].row_key',
	'tables[].observations[].row_label',
	'tables[].observations[].column_key',
	'tables[].footnotes[].footnote_key',
	'tables[].footnotes[].text',
	'tables[].footnotes[].scope',
	'tables[].extraction_runs[].run_id',
] as const;
export const DATASET_REQUIRED_FOR_APPLY = [
	'manifest_version',
	'dataset.dataset_id',
	'dataset.title',
	'dataset.source_page',
	'dataset.source_item',
	'dataset.access_tier',
	'tables[].table_number',
	'tables[].caption',
	'tables[].page',
	'tables[].pdf_file',
	'tables[].pdf_sha1',
	'tables[].extractor',
	'tables[].extractor_version',
	'tables[].method',
	'tables[].panels[].panel_key',
	'tables[].columns[].column_key',
	'tables[].columns[].label',
	'tables[].columns[].datatype',
	'tables[].columns[].role',
	'tables[].observations[].row_index',
	'tables[].observations[].row_key',
	'tables[].observations[].row_label',
	'tables[].observations[].column_key',
	'tables[].footnotes[].footnote_key',
	'tables[].footnotes[].text',
	'tables[].footnotes[].scope',
	'tables[].extraction_runs[].run_id',
	'tables[].extraction_runs[].tool',
	'tables[].extraction_runs[].tool_version',
] as const;
