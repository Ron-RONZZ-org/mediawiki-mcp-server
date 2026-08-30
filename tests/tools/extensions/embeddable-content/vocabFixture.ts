/**
 * The reference instance's vocabulary (wikibase.ronzz.org, verified
 * 2026-08-30), as the wbgetentities response the resolver expects. Kept in
 * step with the DEFAULT_* tables in
 * src/tools/extensions/embeddable-content/embeddableVocabulary.ts — a drift
 * between the two fails the vocabulary tests on purpose.
 */
export const VOCABULARY_ENTITIES: Record<
	string,
	{ id: string; labels: { en: { value: string } } }
> = {
	P1: { id: 'P1', labels: { en: { value: 'instance of' } } },
	P2: { id: 'P2', labels: { en: { value: 'content text' } } },
	P3: { id: 'P3', labels: { en: { value: 'code source' } } },
	P4: { id: 'P4', labels: { en: { value: 'LaTeX source' } } },
	P5: { id: 'P5', labels: { en: { value: 'programming language' } } },
	P6: { id: 'P6', labels: { en: { value: 'attributed to' } } },
	P7: { id: 'P7', labels: { en: { value: 'source URL' } } },
	P8: { id: 'P8', labels: { en: { value: 'date' } } },
	P12: { id: 'P12', labels: { en: { value: 'Wikidata ID' } } },
	P16: { id: 'P16', labels: { en: { value: 'DOI' } } },
	P17: { id: 'P17', labels: { en: { value: 'ISBN-13' } } },
	P18: { id: 'P18', labels: { en: { value: 'OpenAlex Work ID' } } },
	P19: { id: 'P19', labels: { en: { value: 'PubMed ID' } } },
	P24: { id: 'P24', labels: { en: { value: 'page(s)' } } },
	P25: { id: 'P25', labels: { en: { value: 'volume' } } },
	P26: { id: 'P26', labels: { en: { value: 'issue' } } },
	P28: { id: 'P28', labels: { en: { value: 'source' } } },
	P29: { id: 'P29', labels: { en: { value: 'describes' } } },
	P30: { id: 'P30', labels: { en: { value: 'implementation of' } } },
	P44: { id: 'P44', labels: { en: { value: 'part of' } } },
	P45: { id: 'P45', labels: { en: { value: 'duration' } } },
	P46: { id: 'P46', labels: { en: { value: 'YouTube channel ID' } } },
	P47: { id: 'P47', labels: { en: { value: 'YouTube video ID' } } },
	P48: { id: 'P48', labels: { en: { value: 'URL' } } },
	P49: { id: 'P49', labels: { en: { value: 'chapters' } } },
	P54: { id: 'P54', labels: { en: { value: 'publisher (entity)' } } },
	P55: { id: 'P55', labels: { en: { value: 'access URL' } } },
	P57: { id: 'P57', labels: { en: { value: 'journal (entity)' } } },
	Q2: { id: 'Q2', labels: { en: { value: 'quotation content' } } },
	Q3: { id: 'Q3', labels: { en: { value: 'code snippet' } } },
	Q4: { id: 'Q4', labels: { en: { value: 'mathematical expression' } } },
	Q9: { id: 'Q9', labels: { en: { value: 'book' } } },
	Q10: { id: 'Q10', labels: { en: { value: 'scholarly article' } } },
	Q11: { id: 'Q11', labels: { en: { value: 'website' } } },
	Q12: { id: 'Q12', labels: { en: { value: 'song' } } },
	Q13: { id: 'Q13', labels: { en: { value: 'film' } } },
	Q14: { id: 'Q14', labels: { en: { value: 'video' } } },
	Q337: { id: 'Q337', labels: { en: { value: 'YouTube channel' } } },
	Q338: { id: 'Q338', labels: { en: { value: 'YouTube video' } } },
	Q339: { id: 'Q339', labels: { en: { value: 'web page' } } },
	Q340: { id: 'Q340', labels: { en: { value: 'book excerpt' } } },
};

export function vocabularyRequestResponse(): { entities: typeof VOCABULARY_ENTITIES } {
	return { entities: VOCABULARY_ENTITIES };
}
