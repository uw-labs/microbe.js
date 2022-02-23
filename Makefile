install:
	yarn install

update-deps:
	yarn upgrade

lint:
	./node_modules/.bin/eslint --fix . && ./node_modules/.bin/prettier --write './*.js'

test:
	./node_modules/.bin/_mocha test.js
