const path = require('path');
const uuid = require('uuid');
const canister = require('canister.js');

class DI {
	constructor(root) {
		if (!root) {
			root = process.cwd();
		}

		const moduleLoader = new canister.ModuleLoader(root);
		const builder = new canister.Builder(moduleLoader);

		const yamlLoader = new canister.definitionLoader.YAML();

		yamlLoader.fromFile(path.join(__dirname, './wiring.yml'));

		const parser = new canister.Parser(yamlLoader.toJS(), __dirname);

		for (let definition of parser.parse()) {
			builder.addDefinition(definition);
		}

		this.builder = builder;

		this.loader = new canister.definitionLoader.YAML();
	}

	build() {
		const parser = new canister.Parser(this.loader.toJS());

		for (let definition of parser.parse()) {
			this.builder.addDefinition(definition);
		}

		const preRouter = this.builder.getDefinitionById('pre.router');

		this.builder.getDefinitionsByTag('before.router').forEach(definition => {
			preRouter.addCall(
				canister.Definition.call('use', definition)
			);
		});

		const postRouter = this.builder.getDefinitionById('post.router');

		this.builder.getDefinitionsByTag('after.router').forEach(definition => {
			postRouter.addCall(
				canister.Definition.call('use', definition)
			);
		});

		return this.builder.build();
	}
}

module.exports = class Microbe {
	constructor(root) {
		this.di = new DI(root);
	}

	build() {
		this.container = this.di.build();

		this.name = this.container.get('package').name;

		this.server = this.container.get('server');

		this.server.use('/__/about', this.container.get('operational.about').handler);
		this.server.use('/__/health', this.container.get('operational.health').handler);
		this.server.use('/__/ready', this.container.get('operational.ready').handler);

		const promMiddleware = this.container.get('instrumentation').middleware();

		this.server.get(
			'/__/metrics',
			promMiddleware.heapUsage('nodejs_memory_heap_used_bytes', 'nodejs_memory_heap_total_bytes'),
			promMiddleware.report()
		);
		this.server.use(promMiddleware.requestDuration('http_request_seconds'));

		this.logger = this.container.get('logger');

		this.server.use((req, res, next) => {
			req.logger = this.logger.child({r: uuid.v4(), id: (req.header('x-request-id') || uuid.v4())});
			next();
		});

		this.server.use((req, res, next) => {
			(req.logger || this.logger).trace({req});
			next();
		});

		this.bus = this.container.get('bus');

		this.router = this.container.get('router');
		this.pre = this.container.get('pre.router');
		this.post = this.container.get('post.router');

		this.server.use(this.pre);
		this.server.use(this.router);
		this.server.use(this.post);

		this.server.use((err, req, res, next) => {
			(req.logger || this.logger).error({err});
			next(err);
		});

		this.server.use((error, req, res, next) => {
			res.status(error.status || 500).json({status: error.status || 500, message: error.message || 'Internal Server Error'});
			next(error);
		});

		this.server.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
			// no more error chainging
			return;
		});
	}

	configure(filePath) {
		this.di.loader.fromFile(filePath);
	}

	start(port) {
		this.server.listen(port, () => {
			this.logger.info(`${this.name} listening on http://0.0.0.0:${port}`);
		});
	}

	before(middleware) {
		this.pre.use(middleware);
	}

	after(middleware) {
		this.post.use(middleware);
	}

	route() {
		return this.router;
	}

	health(middleware) {
		this.container.get('operational.health').addCheck(middleware);
	}

	ready(middleware) {
		this.container.get('operational.ready').onCall(middleware);
	}
};
