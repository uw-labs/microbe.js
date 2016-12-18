const instrumentation = require('@utilitywarehouse/uw-lib-prometheus.js');
const auth = require('@utilitywarehouse/uw-lib-auth.js');
const bunyan = require('bunyan');
const express = require('express');
const uuid = require('uuid');

class Microbe {
	constructor(name) {
		this._name = name;
		this._instrumentation = this._buildInstrumentation();
		this._auth = auth;
		this._server = this._buildServer();
		this._logger = this._buildLogger();
	}

	_buildLogger() {
		function errSerializer(err) {
			return {type: err.type, status: err.status, message: err.message, previous: err.previous ? errSerializer(err.previous) : null}
		}
		const logger = bunyan.createLogger({
			name: this._name,
			serializers: {err: errSerializer , req: bunyan.stdSerializers.req},
			level: bunyan.TRACE,
			streams: [{
        stream: process.stderr,
        level: bunyan.ERROR
      }]
		});

		return logger;
	}

	_buildServer() {
		const promMiddleware = this.instrumentation.middleware();
		const server = express();
		server.get('/__/status', (req, res) => res.status(200).send('OK'));
		server.get('/__/ready', (req, res) => res.status(200).send('OK'));
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
		const prom = new instrumentation();
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
			{ buckets: [0.01, 0.03, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10] }
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

	start(port, callback) {
		this.server.use((error, req, res, next) => {
			//no more error chainging
			return;
		})
		return this.server.listen(port, () => {
			this.logger.info(`${this.name} listening on 0.0.0.0:${port}`);
			if (callback) {
				callback();
			}
		})
	}
}


module.exports = Microbe;
