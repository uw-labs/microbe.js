const path = require('path');
const uuid = require('uuid');
const canister = require('canister.js');

class MonitorDICycle {
	execute(builder) {
		const monitorDefinition = builder.getDefinitionById('system.monitor');

		for (let callDetails of this.tags(builder)) {
			monitorDefinition.addCall(
				canister.Definition.call('register', callDetails)
			);
		}
	}

	* tags(builder) {
		const definitions = builder.getDefinitionsByTag('system.monitor');
		for (let d of definitions) {
			let t = d.getTag('system.monitor').value;

			const serviceId = d.id;
			const prop = t.prop;
			const name = t.name || d.id;
			const type = t.type;
			const isRequired = t.required || false;
			const isInitiallyConnected = t.initiallyConnected || true;

			yield canister.Definition.structure({serviceId, prop, name, type, isRequired, isInitiallyConnected});
		}
	}
}

class LifecycleDICycle {
	execute(builder) {
		const cycleDefinition = builder.getDefinitionById('system.lifecycle');

		for (let callDetails of this.cycleByTag(builder, 'system.start')) {
			cycleDefinition.addCall(
				canister.Definition.call('registerStart', ...callDetails)
			);
		}

		for (let callDetails of this.cycleByTag(builder, 'system.stop')) {
			cycleDefinition.addCall(
				canister.Definition.call('registerStop', ...callDetails)
			);
		}
	}

	* cycleByTag(builder, tag) {
		const startDefinitions = builder.getDefinitionsByTag(tag);
		for (let d of startDefinitions) {
			let t = d.getTag(tag).value;
			let priority = 0;
			let method = canister.Definition.reference(d.id);
			let context = canister.Definition.value(undefined);
			if (t === undefined || t === null || !isNaN(t)) {
				priority = t || 0;
			} else {
				if (t.priority) {
					priority = t.priority;
				}

				if (t.method) {
					method = canister.Definition.value(t.method);
					context = canister.Definition.reference(d.id);
				}
			}

			yield [canister.Definition.value(priority), method, context];
		}
	}
}

class DI {
	constructor(root) {
		if (!root) {
			root = process.cwd();
		}

		const moduleLoader = new canister.ModuleLoader(root);
		const builder = new canister.Builder(moduleLoader);

		const yamlLoader = new canister.definitionLoader.YAML();

		yamlLoader.fromFile(path.join(__dirname, './wiring.yml'));

		const parser = new canister.Parser(__dirname);

		for (let definition of parser.parse(yamlLoader.toJS())) {
			builder.addDefinition(definition);
		}

		builder.addCycle(new LifecycleDICycle());
		builder.addCycle(new MonitorDICycle());

		this.builder = builder;

		this.loader = new canister.definitionLoader.YAML();
		this.injector = new canister.definitionLoader.Value();
	}

	inject(name, value) {
		this.injector.component(name, value);
	}

	build() {
		const parser = new canister.Parser();

		const env = new canister.definitionLoader.Environment();

		env.load();

		for (let definition of parser.parse(this.loader.toJS())) {
			this.builder.addDefinition(definition);
		}

		for (let definition of parser.parse(env.toJS())) {
			this.builder.addDefinition(definition);
		}

		for (let definition of parser.parse(this.injector.toJS())) {
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
			req.id = req.header('x-request-id') || uuid.v4();
			req.logger = this.logger.child({r: uuid.v4(), id: req.id});
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

		this.server.use((error, req, res, next) => {
			(req.logger || this.logger).error({error});
			next(error);
		});

		this.server.use((error, req, res, next) => {
			const err = {
				status: error.status || 500,
				type: error.type || (error.name || 'ServerError'),
				message: error.message || 'Internal Server Error',
				reference: error.reference
			};
			res.status(err.status).json(err);
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

	health(name, middleware) {
		this.container.get('operational.health').addCheck(name, middleware);
	}

	ready(middleware) {
		this.container.get('operational.ready').onCall(middleware);
	}

	bootstrap() {
		return this.container.get('system.lifecycle').start();
	}

	teardown() {
		return this.container.get('system.lifecycle').stop();
	}

	get(service) {
		return this.container.get(service);
	}
};
