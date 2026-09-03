#!/usr/bin/env node
// Live-wiki E2E for the built MCP server (CI job + local runs).
//
// Prerequisites (run from anywhere; paths resolve off this file):
//   1. npm ci && npm run build
//   2. The scripts/e2e/docker-compose.yml stack is up and healthy:
//        docker compose -p mcp-e2e -f scripts/e2e/docker-compose.yml up -d --wait
//
// The script creates a bot password for the stack's admin (MW_ADMIN_NAME),
// writes a throwaway config.json, starts dist/index.js over stdio, and
// drives real tools/call round-trips through the MCP client SDK:
// whoami, create-page/get-page, and the Wikibase pack (edit-entity,
// get-entity, search-entities, add-statement, setsitelink). It exits non-zero
// on any failed assertion. The stack is left running for the caller to tear
// down (`docker compose ... down -v`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const composeFile = join(repoRoot, 'scripts', 'e2e', 'docker-compose.yml');
const serverEntry = join(repoRoot, 'dist', 'index.js');
const project = 'mcp-e2e';

// Keep in step with scripts/e2e/docker-compose.yml.
const admin = 'MCPCIAdmin';
const wikiBaseUrl = 'http://127.0.0.1:8082';
// The grant set from docs/testing.md (bot password for the suite's write
// tools): enough for page edits, entity edits, uploads and property/lexeme
// work without touching protected or admin surfaces.
const grants =
	'basic,highvolume,editpage,editprotected,createeditmovepage,delete,uploadfile,uploadeditmovefile';

const stamp = Date.now();
let failures = 0;

function ok(label) {
	console.log(`  [ ok ] ${label}`);
}

function fail(label, detail = '') {
	failures += 1;
	console.log(`  [FAIL] ${label}${detail === '' ? '' : `\n         ${detail}`}`);
}

function assert(condition, label, detail = '') {
	if (condition) {
		ok(label);
	} else {
		fail(label, detail);
	}
}

function compose(args) {
	const result = spawnSync('docker', ['compose', '-p', project, '-f', composeFile, ...args], {
		encoding: 'utf8',
	});
	if (result.error) {
		console.error(`docker compose ${args[0]}: ${result.error.message}`);
		process.exit(2);
	}
	return result;
}

function requireStack() {
	const status = compose(['ps', '--status', 'running', '--format', '{{.Service}}']);
	if (status.status !== 0) {
		console.error('The E2E stack is not running. Start it first:\n');
		console.error('  docker compose -p mcp-e2e -f scripts/e2e/docker-compose.yml up -d --wait');
		process.exit(2);
	}
	const services = status.stdout.split('\n').filter((line) => line !== '');
	for (const required of ['wikibase', 'wikibase-jobrunner', 'mysql']) {
		if (!services.includes(required)) {
			console.error(`E2E stack service "${required}" is not running.`);
			process.exit(2);
		}
	}
}

/**
 * Registers the wiki's own sitelink site (global key 'wikibase', group
 * 'ronzz' — the group scripts/e2e/Extensions.php allows) with the URL paths
 * the site store needs. Without the row, wbsetsitelink rejects the site as
 * unrecognized; without the paths it fails on URL generation.
 *
 * The web workers cache the sites table in APCu ($wgMainCacheType =
 * CACHE_ACCEL), so the container is restarted afterwards to reload it — the
 * addSite.php output warns about exactly this.
 */
function registerSitelinkSite() {
	const row = compose([
		'exec',
		'-T',
		'mysql',
		'mysql',
		'-uwikiuser',
		'-psqlpass',
		'my_wiki',
		'-e',
		"delete from sites where site_global_key = 'wikibase';",
	]);
	if (row.status !== 0) {
		console.error(`Could not clear a previous wikibase site row:\n${row.stderr}`);
		process.exit(2);
	}
	const result = compose([
		'exec',
		'-T',
		'wikibase',
		'php',
		'maintenance/run.php',
		'addSite.php',
		'wikibase',
		'ronzz',
		'--language',
		'en',
		'--pagepath',
		'http://wikibase/wiki/$1',
		'--filepath',
		'http://wikibase/w/$1',
	]);
	if (result.status !== 0) {
		console.error(
			`addSite.php failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
		);
		process.exit(2);
	}

	const restart = compose(['restart', 'wikibase']);
	if (restart.status !== 0) {
		console.error(`docker compose restart wikibase failed:\n${restart.stderr}`);
		process.exit(2);
	}
	waitForWiki();
}

/** Polls api.php until the restarted web server answers 200 (max ~2 min). */
function waitForWiki() {
	const deadline = Date.now() + 120_000;
	for (;;) {
		const probe = spawnSync(
			'curl',
			['-s', '-o', '/dev/null', '-w', '%{http_code}', `${wikiBaseUrl}/w/api.php`],
			{
				encoding: 'utf8',
			},
		);
		if (probe.status === 0 && probe.stdout === '200') {
			return;
		}
		if (Date.now() > deadline) {
			console.error('The wikibase container did not answer api.php after restart.');
			process.exit(2);
		}
		const sleep = spawnSync('sleep', ['3']);
		if (sleep.status !== 0) {
			process.exit(2);
		}
	}
}

function createBotPassword() {
	const result = compose([
		'exec',
		'-T',
		'wikibase',
		'php',
		'maintenance/run.php',
		'createBotPassword',
		'--appid',
		`mcp-ci-${stamp}`,
		'--grants',
		grants,
		admin,
	]);
	const output = `${result.stdout}\n${result.stderr}`;
	// createBotPassword.php echoes the credentials as
	// "Log in using username:'MCPCIAdmin@mcp-ci-<stamp>' and password:'<32 chars>'."
	// MediaWiki bot passwords authenticate with the combined user@appid name.
	const usernameMatch = /username:'([^']+)'/.exec(output);
	const passwordMatch = /password:'([A-Za-z0-9]{8,})'/.exec(output);
	if (result.status !== 0 || usernameMatch === null || passwordMatch === null) {
		console.error(`createBotPassword failed (exit ${result.status}):\n${output}`);
		process.exit(2);
	}
	return { username: usernameMatch[1], password: passwordMatch[1] };
}

/** Asserts a value is present, then returns it; aborts the run on failure. */
function required(pattern, text, label) {
	const match = pattern.exec(text);
	if (match === null) {
		fail(label, text);
		throw new Error(`${label}: could not read a value from the tool result`);
	}
	ok(label);
	return match[1];
}

function toolText(result) {
	const text = result.content?.[0]?.text;
	return typeof text === 'string' ? text : '';
}

function isErrorResult(result) {
	return result.isError === true;
}

async function main() {
	requireStack();
	registerSitelinkSite();

	console.log(`\nProvisioning bot password for ${admin} ...`);
	const botCredentials = createBotPassword();
	ok('bot password created');

	const configDir = mkdtempSync(join(tmpdir(), 'mcp-e2e-'));
	const configPath = join(configDir, 'config.json');
	writeFileSync(
		configPath,
		JSON.stringify(
			{
				defaultWiki: 'wikibase-e2e',
				wikis: {
					'wikibase-e2e': {
						sitename: 'wikibase',
						server: wikiBaseUrl,
						articlepath: '/wiki',
						scriptpath: '/w',
						username: botCredentials.username,
						password: botCredentials.password,
					},
				},
			},
			null,
			2,
		),
	);

	if (!existsSync(serverEntry)) {
		console.error(`Built server not found at ${serverEntry}. Run npm run build first.`);
		process.exit(2);
	}

	console.log('\nStarting the built server and connecting the MCP client ...');
	const client = new Client({ name: 'mediawiki-mcp-server-ci-e2e', version: '1.0.0' });
	const transport = new StdioClientTransport({
		command: 'node',
		args: [serverEntry],
		cwd: repoRoot,
		env: {
			...process.env,
			CONFIG: configPath,
			// The wiki sits on loopback; the outbound SSRF guard would refuse it.
			MCP_TRUSTED_HOSTS: '127.0.0.1',
		},
		stderr: process.stderr,
	});
	await client.connect(transport);

	try {
		await runChecks(client, botCredentials.username);
	} catch (error) {
		console.error(`\nE2E aborted: ${error.message}`);
		process.exitCode = 1;
	} finally {
		await client.close();
		rmSync(configDir, { recursive: true, force: true });
	}
}

async function runChecks(client, botUsername) {
	console.log('\n== tools/list ==');
	const tools = await client.listTools();
	const names = tools.tools.map((tool) => tool.name).sort();
	const expected = [
		'whoami',
		'get-page',
		'create-page',
		'search-page',
		'wikibase-search-entities',
		'wikibase-get-entity',
		'wikibase-edit-entity',
		'wikibase-add-statement',
		'wikibase-setsitelink',
	];
	for (const name of expected) {
		assert(names.includes(name), `tool advertised: ${name}`);
	}
	const extensionTools = names.filter(
		(name) => name.startsWith('embeddable-') || name.startsWith('citation-'),
	);
	assert(
		extensionTools.length === 0,
		'no EmbeddableContent/WikibaseCitation tools on a stock wiki',
		`unexpectedly offered: ${extensionTools.join(', ')}`,
	);

	console.log('\n== whoami ==');
	const who = await client.callTool({ name: 'whoami', arguments: {} });
	const whoText = toolText(who);
	assert(!isErrorResult(who), 'whoami succeeds', whoText);
	assert(whoText.includes(botUsername.split('@')[0]), 'whoami reports the bot account', whoText);

	console.log('\n== page round-trip (create-page → get-page) ==');
	const pageTitle = `MCP E2E page ${stamp}`;
	const pageBody = `Hello from the MCP CI e2e run ${stamp}.`;
	const created = await client.callTool({
		name: 'create-page',
		arguments: { title: pageTitle, source: pageBody },
	});
	const createdText = toolText(created);
	assert(!isErrorResult(created), 'create-page succeeds', createdText);
	assert(createdText.includes(pageTitle), 'create-page names the page', createdText);

	const fetched = await client.callTool({
		name: 'get-page',
		arguments: { title: pageTitle },
	});
	const fetchedText = toolText(fetched);
	assert(!isErrorResult(fetched), 'get-page succeeds', fetchedText);
	assert(fetchedText.includes(pageBody), 'get-page returns the written content', fetchedText);

	console.log('\n== Wikibase: create item (wbeditentity) ==');
	const itemLabel = `MCP E2E item ${stamp}`;
	const item = await client.callTool({
		name: 'wikibase-edit-entity',
		arguments: {
			data: {
				labels: { en: { language: 'en', value: itemLabel } },
				descriptions: { en: { language: 'en', value: 'created by the MCP CI e2e run' } },
			},
		},
	});
	const itemText = toolText(item);
	assert(!isErrorResult(item), 'item create succeeds', itemText);
	const itemId = required(/Entity ID:\s*(Q\d+)/, itemText, 'item create returns a Q-id');
	ok(`  item id: ${itemId}`);

	console.log('\n== Wikibase: read + search the item ==');
	const readItem = await client.callTool({
		name: 'wikibase-get-entity',
		arguments: { entityId: itemId },
	});
	const readItemText = toolText(readItem);
	assert(!isErrorResult(readItem), 'wikibase-get-entity succeeds', readItemText);
	assert(readItemText.includes(itemLabel), 'entity read shows the label', readItemText);

	const search = await client.callTool({
		name: 'wikibase-search-entities',
		arguments: { query: itemLabel, mode: 'prefix' },
	});
	const searchText = toolText(search);
	assert(!isErrorResult(search), 'wikibase-search-entities succeeds', searchText);
	assert(searchText.includes(itemId), 'prefix search finds the item', searchText);

	console.log('\n== Wikibase: create property + add statement ==');
	const propertyLabel = `MCP E2E property ${stamp}`;
	const property = await client.callTool({
		name: 'wikibase-edit-entity',
		arguments: {
			entityType: 'property',
			data: {
				datatype: 'string',
				labels: { en: { language: 'en', value: propertyLabel } },
			},
		},
	});
	const propertyText = toolText(property);
	assert(!isErrorResult(property), 'property create succeeds', propertyText);
	const propertyId = required(
		/Entity ID:\s*(P\d+)/,
		propertyText,
		'property create returns a P-id',
	);
	ok(`  property id: ${propertyId}`);

	const claimValue = `mcp-ci-value-${stamp}`;
	const added = await client.callTool({
		name: 'wikibase-add-statement',
		arguments: { entityId: itemId, propertyId, value: claimValue },
	});
	const addedText = toolText(added);
	assert(!isErrorResult(added), 'wikibase-add-statement succeeds', addedText);
	assert(/Statement ID:\s*\S+/.test(addedText), 'add-statement returns a statement id', addedText);

	const readWithClaim = await client.callTool({
		name: 'wikibase-get-entity',
		arguments: { entityId: itemId },
	});
	const readWithClaimText = toolText(readWithClaim);
	assert(
		readWithClaimText.includes(claimValue),
		'entity read shows the added statement value',
		readWithClaimText,
	);

	console.log('\n== Wikibase: sitelink the item to the created page ==');
	const sitelink = await client.callTool({
		name: 'wikibase-setsitelink',
		arguments: { qid: itemId, page: pageTitle },
	});
	const sitelinkText = toolText(sitelink);
	assert(!isErrorResult(sitelink), 'wikibase-setsitelink succeeds', sitelinkText);
	assert(sitelinkText.includes(itemId), 'sitelink names the item', sitelinkText);

	console.log(
		failures === 0
			? '\nAll live-wiki E2E checks passed.'
			: `\n${failures} live-wiki E2E check(s) failed.`,
	);
	process.exitCode = failures === 0 ? 0 : 1;
}

await main();
