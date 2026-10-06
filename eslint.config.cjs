const globals = require('globals');
const { fixupPluginRules } = require('@eslint/compat');

// eslint-plugin-spellcheck (unmaintained) uses context.getSourceCode(), removed in eslint 10;
// only it gets the compat shim so anything else that breaks still fails loudly.
const needsFixup = new Set(['spellcheck']);
const vanillaBeanEslint = require('@vanilla-bean/components/eslint.config.cjs').map(config =>
	config.plugins
		? {
				...config,
				plugins: Object.fromEntries(
					Object.entries(config.plugins).map(([name, plugin]) => [
						name,
						needsFixup.has(name) ? fixupPluginRules(plugin) : plugin,
					]),
				),
			}
		: config,
);
const vanillaBeanSpellcheck = require('@vanilla-bean/components/spellcheck.config.cjs');
const localSpellcheck = require('./spellcheck.config.cjs');

module.exports = [
	...vanillaBeanEslint,
	{
		rules: {
			'no-unused-vars': ['error', { ignoreRestSiblings: true }],
			'import/no-unresolved': ['warn', { ignore: ['bun', 'bun:test', String.raw`\.asText$`] }],
			'spellcheck/spell-checker': [
				'warn',
				{
					...vanillaBeanSpellcheck,
					...localSpellcheck,
					skipWords: [...vanillaBeanSpellcheck.skipWords, ...localSpellcheck.skipWords],
				},
			],
		},
	},
	{
		// Test files are full of fixture strings and shorthand identifiers that aren't words
		files: ['**/*.test.js'],
		rules: {
			'spellcheck/spell-checker': 'off',
		},
	},
	{
		files: [
			'server/*.js',
			'server/**/*.js',
			'scripts/**/*.js',
			'client/build.js',
			'cli/**/*.js',
			'bin/**/*.js',
			'shared/writeJsonFile.js',
		],
		languageOptions: {
			globals: {
				...globals.node,
				Bun: true,
			},
		},
		rules: {
			'no-console': 'off',
		},
	},
];
