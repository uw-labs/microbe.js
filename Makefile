install:
	yarn install

update-deps:
	yarn upgrade

lint:
	./node_modules/.bin/xo index.js
