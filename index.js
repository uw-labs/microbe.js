const Instrumentation = require('@utilitywarehouse/uw-lib-prometheus.js');
const auth = require('@utilitywarehouse/uw-lib-auth.js');
const operational = require('@utilitywarehouse/uw-lib-operational.js');
const bunyan = require('bunyan');
const express = require('express');
const uuid = require('uuid');
const path = require('path');

const safeCycles = bunyan.safeCycles;

// modified from https://github.com/trentm/node-bunyan/blob/master/examples/specific-level-streams.js
class RecordWriter {
	constructor(levels, stream) {
		this.levels = {};
		levels.forEach(lvl => {
			this.levels[bunyan.resolveLevel(lvl)] = true;
		});
		this.stream = stream;
	}

	mapLevelToString(lvl) {
		return bunyan.nameFromLevel[lvl];
	}

	write(record) {
		if (this.levels[record.level] !== undefined) {
			record.severity = this.mapLevelToString(record.level);
			const str = JSON.stringify(record, safeCycles()) + '\n';
			this.stream.write(str);
		}
	}
}

class Microbe {
	constructor(name, root) {
		this._root = root || process.cwd();
		this._name = name;
		this._logger = this._buildLogger();
		try {
			this._package = require(path.join(this._root, 'package.json'));
		} catch(err) {
			this._logger.warn({err}, 'Unable to load package.json');
			this._package = {}
		}
		this._instrumentation = this._buildInstrumentation();
		this._auth = auth;
		this._server = this._buildServer();
	}

	_buildLogger() {
		function errSerializer(err) {
			return {type: err.type, status: err.status, message: err.message, previous: err.previous ? errSerializer(err.previous) : null};
		}
		const logger = bunyan.createLogger({
			name: this._name,
			serializers: {err: errSerializer, req: bunyan.stdSerializers.req},
			level: bunyan.TRACE,
			streams: [
				{
					type: 'raw',
					stream: new RecordWriter(
          [bunyan.ERROR, bunyan.FATAL],
          process.stderr
        ),
					level: bunyan.ERROR
				},
				{
					type: 'raw',
					stream: new RecordWriter(
          [bunyan.TRACE, bunyan.INFO, bunyan.DEBUG, bunyan.WARN],
          process.stdout
        ),
					level: bunyan.TRACE
				}
			]
		});

		return logger;
	}

	_buildOperationalEndpoints(server) {
		const about = new operational.About();
		about.setMeta(this._name, this._package.description);
		if (this._package.author) {
			about.addOwner({name: this._package.author});
		}
		if (this._package.homepage) {
			about.addLink('readme', this._package.homepage);
		}
		try {
			about.fromFile(path.join(this._root, 'build.json'));
		} catch(err) {
			this._logger.warn({err}, 'Unable to load build.json');
		}
		const health = new operational.Health(this._name, this._package.description || this._name);
		const ready = new operational.Ready();
		server.use('/__/about', about.handler);
		server.use('/__/health', health.handler);
		server.use('/__/ready', ready.handler);

		this._operational = {about, health, ready};
	}

	_buildServer() {
		const promMiddleware = this.instrumentation.middleware();
		const server = express();
		this._buildOperationalEndpoints(server);
		server.get(
			'/__/metrics',
			promMiddleware.heapUsage('nodejs_memory_heap_used_bytes', 'nodejs_memory_heap_total_bytes'),
			promMiddleware.report()
		);
		server.use(promMiddleware.requestDuration('http_request_seconds'));
		server.use((req, res, next) => {
			req.logger = this.logger.child({r: uuid.v4(), id: (req.header('x-request-id') || uuid.v4())});
			next();
		});

		return server;
	}

	_buildInstrumentation() {
		const prom = new Instrumentation();
		prom.newGauge(
			'nodejs_memory_heap_used_bytes',
			'process.memoryUsage().heapUsed'
		);
		prom.newGauge(
			'nodejs_memory_heap_total_bytes',
			'process.memoryUsage().heapTotal'
		);
		prom.newHistogram(
			'http_request_seconds',
			'Measures request duration',
			['http_status', 'route', 'http_method'],
			{buckets: [0.01, 0.03, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10]}
		);
		return prom;
	}

	enableAccessLog() {
		this.server.use((req, res, next) => {
			(req.logger || this.logger).trace({req});
			next();
		});
	}

	enableErrorLog() {
		this.server.use((err, req, res, next) => {
			(req.logger || this.logger).error({err});
			next(err);
		});
	}

	enableAuth(provider) {
		return this.server.use(provider.middleware());
	}

	enableErrorHandler() {
		this.server.use((error, req, res, next) => {
			res.status(error.status || 500).json({status: error.status || 500, message: error.message || 'Internal Server Error'});
			next(error);
		});
	}

	get name() {
		return this._name;
	}

	get logger() {
		return this._logger;
	}

	get server() {
		return this._server;
	}

	get instrumentation() {
		return this._instrumentation;
	}

	get auth() {
		return this._auth;
	}

	get operational() {
		return this._operational;
	}

	start(port, callback) {
		this.server.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
			// no more error chainging
			return;
		});
		return this.server.listen(port, () => {
			this.logger.info(`${this.name} listening on http://0.0.0.0:${port}`);
			if (callback) {
				callback();
			}
		});
	}
}

module.exports = Microbe;
