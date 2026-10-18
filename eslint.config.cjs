const globals = require('globals');

module.exports = [
	...require('@vanilla-bean/components/eslint.app.config.cjs'),
	{
		// The browser harness and its fixtures are code, not prose
		files: ['e2e/**/*.js'],
		rules: {
			'spellcheck/spell-checker': 'off',
		},
	},
	{
		// Beyond the profile's server/, scripts/, cli/, bin/ and e2e/: the shared modules only the server and the cli import
		files: [
			'shared/writeJsonFile.js',
			'shared/updateJsonFile*.js',
			'shared/readJsonFile.js',
			'shared/credentials.js',
			'shared/serverClient.js',
		],
		languageOptions: {
			globals: {
				...globals.node,
				Bun: false,
			},
		},
		rules: {
			'no-console': 'off',
		},
	},
];
