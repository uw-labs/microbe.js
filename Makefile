install:
	yarn install

update-deps:
	yarn upgrade

test:
	./node_modules/.bin/_mocha test.js
