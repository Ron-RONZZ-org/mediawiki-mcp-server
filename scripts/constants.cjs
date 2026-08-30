'use strict';

const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
// mcpb names the packed artifact after the repo directory (e.g.
// MediaWiki-MCP-Server.mcpb upstream, mediawiki-mcp-server.mcpb on a
// differently-named fork); deriving it keeps the bundle steps working
// under any repo name instead of hardcoding the upstream's.
const MCPB_FILE = path.basename(ROOT_DIR) + '.mcpb';
const MANIFEST_FILE = 'manifest.json';

module.exports = {
	ROOT_DIR,
	MCPB_FILE,
	MANIFEST_FILE,
	PACKAGE_JSON_PATH: path.join(ROOT_DIR, 'package.json'),
	SERVER_JSON_PATH: path.join(ROOT_DIR, 'server.json'),
	MANIFEST_JSON_PATH: path.join(ROOT_DIR, 'mcpb', MANIFEST_FILE),
	CLAUDE_MARKETPLACE_JSON_PATH: path.join(ROOT_DIR, '.claude-plugin', 'marketplace.json'),
	CLAUDE_PLUGIN_JSON_PATH: path.join(
		ROOT_DIR,
		'plugins',
		'mediawiki-mcp-server',
		'.claude-plugin',
		'plugin.json',
	),
	CODEX_MARKETPLACE_JSON_PATH: path.join(ROOT_DIR, '.agents', 'plugins', 'marketplace.json'),
	CODEX_PLUGIN_JSON_PATH: path.join(
		ROOT_DIR,
		'plugins',
		'mediawiki-mcp-server',
		'.codex-plugin',
		'plugin.json',
	),
	CHANGELOG_PATH: path.join(ROOT_DIR, 'CHANGELOG.md'),
	MCPB_BUNDLE_PATH: path.join(ROOT_DIR, MCPB_FILE),
};
