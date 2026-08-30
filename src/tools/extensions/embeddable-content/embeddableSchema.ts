/**
 * The MCP-facing enum tables shared by the embeddable add tools' input
 * schemas. The FIELD CONTRACT (which class exposes which fields, what is
 * required) is NOT defined here anymore: it lives on the wiki — in the
 * EmbeddableContent extension's Flow/*FieldMap classes, served to this
 * server by the action=*fields endpoints and reported by
 * embeddable-describe-entity-type. Keep these enum tables in step with the
 * wiki's field maps, but never add field-exposure data back here.
 */

export const SPECIAL_CONTENT_KINDS = ['quotation', 'math', 'code-snippet'] as const;
export type SpecialContentKind = (typeof SPECIAL_CONTENT_KINDS)[number];

export const SOURCE_CLASS_KEYS = [
	'book',
	'scholarly-article',
	'website',
	'webpage',
	'song',
	'film',
	'video',
	'youtube-channel',
	'youtube-video',
	'book-excerpt',
] as const;
export type SourceClassKey = (typeof SOURCE_CLASS_KEYS)[number];

export const SOURCE_FIELDS = [
	'title',
	'description',
	'authors',
	'publisher',
	'journal',
	'volume',
	'issue',
	'pages',
	'chapters',
	'year',
	'isbn',
	'doi',
	'wikidataId',
	'openalexWorkId',
	'pubmedId',
	'url',
	'duration',
	'youtubeChannelId',
	'youtubeVideoId',
	'accessUrl',
	'parent',
] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];
