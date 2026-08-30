import type { EmbeddableClasses } from './embeddableVocabulary.ts';

/**
 * Shared field/class metadata for the EmbeddableContent Add* flows and the
 * describe-entity-type discovery tool. One source of truth so the discovery
 * tool always reports what the write tools accept.
 */

export const SPECIAL_CONTENT_KINDS = ['quotation', 'math', 'code-snippet'] as const;
export type SpecialContentKind = (typeof SPECIAL_CONTENT_KINDS)[number];

/** The vocabulary payload key for each special-content kind. */
export const PAYLOAD_KEY: Record<SpecialContentKind, 'quotation' | 'code' | 'math'> = {
	quotation: 'quotation',
	math: 'math',
	'code-snippet': 'code',
};

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

/** The class each child class requires as its parent. */
export const PARENT_CLASS: Partial<Record<SourceClassKey, keyof EmbeddableClasses>> = {
	webpage: 'website',
	'youtube-video': 'youtubeChannel',
	'book-excerpt': 'book',
};

export const CLASS_KEY_TO_VOCAB: Record<SourceClassKey, keyof EmbeddableClasses> = {
	book: 'book',
	'scholarly-article': 'scholarlyArticle',
	website: 'website',
	webpage: 'webpage',
	song: 'song',
	film: 'film',
	video: 'video',
	'youtube-channel': 'youtubeChannel',
	'youtube-video': 'youtubeVideo',
	'book-excerpt': 'bookExcerpt',
};

/** The fields each class's review form exposes. */
export const CLASS_FIELDS: Record<SourceClassKey, ReadonlySet<SourceField>> = {
	book: new Set([
		'title',
		'description',
		'authors',
		'publisher',
		'pages',
		'year',
		'isbn',
		'accessUrl',
		'wikidataId',
	]),
	'scholarly-article': new Set([
		'title',
		'description',
		'authors',
		'journal',
		'publisher',
		'volume',
		'issue',
		'pages',
		'year',
		'doi',
		'accessUrl',
		'wikidataId',
		'openalexWorkId',
		'pubmedId',
	]),
	website: new Set(['title', 'description', 'url', 'wikidataId']),
	webpage: new Set(['title', 'description', 'url', 'year', 'parent', 'wikidataId']),
	song: new Set(['title', 'description', 'authors', 'year', 'duration', 'accessUrl']),
	film: new Set(['title', 'description', 'authors', 'year', 'duration', 'accessUrl']),
	video: new Set(['title', 'description', 'authors', 'year', 'duration', 'url']),
	'youtube-channel': new Set(['title', 'description', 'year', 'url', 'youtubeChannelId']),
	'youtube-video': new Set([
		'title',
		'description',
		'authors',
		'year',
		'duration',
		'url',
		'youtubeVideoId',
		'parent',
	]),
	'book-excerpt': new Set([
		'title',
		'description',
		'authors',
		'pages',
		'volume',
		'chapters',
		'year',
		'accessUrl',
		'parent',
	]),
};

/** Human-readable label of each source class, for the discovery output. */
export const CLASS_LABELS: Record<SourceClassKey, string> = {
	book: 'book',
	'scholarly-article': 'scholarly article',
	website: 'website',
	webpage: 'web page',
	song: 'song',
	film: 'film',
	video: 'video',
	'youtube-channel': 'YouTube channel',
	'youtube-video': 'YouTube video',
	'book-excerpt': 'book excerpt',
};

/** One-line role of each source field, for the discovery output. */
export const FIELD_LABELS: Record<SourceField, string> = {
	title: 'the work title; becomes the item label',
	description: 'a short description; becomes the English description',
	authors: 'comma/semicolon-separated item IDs; at least one required except for book-excerpt',
	publisher: 'item ID of the publisher (entity-only)',
	journal: 'item ID of the journal (entity-only, scholarly-article)',
	volume: 'volume (scholarly-article, book-excerpt)',
	issue: 'issue (scholarly-article)',
	pages: 'page range or count',
	chapters: 'chapter count or range (book-excerpt)',
	year: 'four-digit publication year, stored at year precision',
	isbn: 'ISBN-13 (book)',
	doi: 'DOI (scholarly-article)',
	wikidataId: 'the corresponding Wikidata entity ID',
	openalexWorkId: 'OpenAlex Work ID (scholarly-article)',
	pubmedId: 'PubMed ID (scholarly-article)',
	url: "the work's URL",
	duration: 'runtime as MM:SS or HH:MM:SS, stored as whole seconds',
	youtubeChannelId: 'the YouTube channel ID',
	youtubeVideoId: 'the YouTube video ID',
	accessUrl: 'a non-direct access URL',
	parent: 'item ID of the parent-class item (required for child classes)',
};

/**
 * Vocabulary path behind each source field; title and description are terms
 * (label / description), not statements. Used by the write tool to decide
 * which vocabulary entries a call needs.
 */
export const SOURCE_FIELD_PATH: Partial<Record<SourceField, string>> = {
	authors: 'provenance.attributedTo',
	publisher: 'citationMetadata.publisher',
	journal: 'citationMetadata.journal',
	volume: 'citationMetadata.volume',
	issue: 'citationMetadata.issue',
	pages: 'citationMetadata.pages',
	chapters: 'sourceProperties.chapters',
	year: 'provenance.date',
	isbn: 'externalIds.isbn13',
	doi: 'externalIds.doi',
	wikidataId: 'externalIds.wikidataId',
	openalexWorkId: 'externalIds.openalexWorkId',
	pubmedId: 'externalIds.pubmedId',
	url: 'sourceProperties.url',
	duration: 'sourceProperties.duration',
	youtubeChannelId: 'sourceProperties.youtubeChannelId',
	youtubeVideoId: 'sourceProperties.youtubeVideoId',
	accessUrl: 'sourceProperties.accessUrl',
	parent: 'sourceProperties.partOf',
};
