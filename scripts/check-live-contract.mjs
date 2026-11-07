#!/usr/bin/env node
// Compares the pinned EmbeddableContent field contract against a live wiki's
// discovery endpoints. The contract is vendored from the ronzz-wikibase repo,
// so this is the cross-repo drift guard the local `gen:field-contract` cannot
// provide: a wiki class/field added after the last contract refresh fails here
// before a model sees a class the add tool cannot accept.
//
// Usage:
//   WIKI_URL=https://wikibase.ronzz.org node scripts/check-live-contract.mjs
//
// Exit codes: 0 = no drift, 1 = drift or a request failure.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIKI = (process.env.WIKI_URL ?? 'https://wikibase.ronzz.org').replace(/\/$/, '');
const contractPath = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'src/tools/extensions/embeddable-content/contract/field-contract.json',
);
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const ENDPOINTS = {
	'citation-source': { action: 'addsource-fields', key: 'sourcefields', group: 'classes' },
	'semantic-entity': { action: 'addsemanticentity-fields', key: 'semanticfields', group: 'kinds' },
	'special-content': { action: 'addspecialcontent-fields', key: 'contentfields', group: 'kinds' },
};

const problems = [];

function fail(message) {
	problems.push(message);
}

function asMap(entries, keyName) {
	const map = new Map();
	for (const entry of entries) {
		const key = entry[keyName];
		if (typeof key === 'string') {
			map.set(key, entry);
		}
	}
	return map;
}

function compareSets(label, pinned, live) {
	const pinnedSet = new Set(pinned);
	const liveSet = new Set(live);
	const missing = [...liveSet].filter((value) => !pinnedSet.has(value));
	const extra = [...pinnedSet].filter((value) => !liveSet.has(value));
	if (missing.length > 0) {
		fail(`${label}: live-only values not in the pinned contract: ${missing.join(', ')}`);
	}
	if (extra.length > 0) {
		fail(`${label}: pinned-only values absent from the live wiki: ${extra.join(', ')}`);
	}
}

async function fetchGroup(flow) {
	const { action, key, group } = ENDPOINTS[flow];
	const url = `${WIKI}/api.php?action=${action}&format=json&formatversion=2`;
	let response;
	try {
		response = await fetch(url, { headers: { accept: 'application/json' } });
	} catch (error) {
		fail(`${flow}: request failed (${url}): ${error.message}`);
		return null;
	}
	if (!response.ok) {
		fail(`${flow}: HTTP ${response.status} from ${url}`);
		return null;
	}
	const body = await response.json();
	const entries = body?.[key]?.[group];
	if (!Array.isArray(entries)) {
		fail(`${flow}: ${key}.${group} missing from ${url}`);
		return null;
	}
	return asMap(entries, group === 'classes' ? 'classKey' : 'kind');
}

for (const [flow, node] of Object.entries(contract.flows)) {
	const pinned = node.kinds ?? node.classes ?? {};
	const live = await fetchGroup(flow);
	if (live === null) {
		continue;
	}
	compareSets(`${flow} keys`, Object.keys(pinned), [...live.keys()]);
	for (const [name, entry] of Object.entries(pinned)) {
		const liveEntry = live.get(name);
		if (liveEntry === undefined) {
			continue;
		}
		compareSets(`${flow}/${name} fields`, entry.fields ?? [], liveEntry.fields ?? []);
		compareSets(
			`${flow}/${name} requiredOnCreate`,
			entry.requiredOnCreate ?? [],
			liveEntry.requiredOnCreate ?? [],
		);
		if (Array.isArray(entry.requiredAnyOf)) {
			const canonical = (row) => [...row].sort((a, b) => a.localeCompare(b)).join('|');
			const pinnedAny = (entry.requiredAnyOf ?? [])
				.map(canonical)
				.sort((a, b) => a.localeCompare(b));
			const liveAny = (liveEntry.requiredAnyOf ?? [])
				.map(canonical)
				.sort((a, b) => a.localeCompare(b));
			compareSets(`${flow}/${name} requiredAnyOf`, pinnedAny, liveAny);
		}
	}
}

if (problems.length > 0) {
	console.error(`Contract drift against ${WIKI}:`);
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	console.error(
		'\nRefresh the pinned contract from ronzz-wikibase, then run `npm run gen:field-contract`.',
	);
	process.exit(1);
}

console.log(`Contract matches ${WIKI}: ${Object.keys(contract.flows).join(', ')}.`);
