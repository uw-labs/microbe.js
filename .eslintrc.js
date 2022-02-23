module.exports = {
	extends: ["prettier"],
	env: {
		node: true,
		es6: true,
	},
	parserOptions: {
		ecmaVersion: 2017,
	},
	overrides: [
		{
			files: ["**/*.spec.js", "**/*.test.js"],
			env: {
				mocha: true,
			},
			globals: {
				sinon: true,
				expect: true,
				should: true,
			},
		},
	],
	rules: {
		"no-underscore-dangle": "off",
		"no-bitwise": "off",
		"no-restricted-globals": "off",
		"no-shadow": "off",
	},
};
