install:
	yarn install

update-deps:
	yarn upgrade

lint:
	./node_modules/.bin/xo index.js

test:
	./node_modules/.bin/_mocha test.js
