const stream = require('stream');
const chai = require('chai');
const request = require('supertest');
const Microbe = require('.');
const expect = chai.expect;
const pkg = require('./package.json');
const error = require('@utilitywarehouse/uw-lib-error.js');

class LoggerStream extends stream.Writable {

	constructor(data) {
		super({objectMode: true});
		this.data = data;
	}

	_write(chunk, encoding, next) {
		this.data.push(chunk);
		next();
	}
}

describe('Microbe', function() {
	beforeEach(function() {
		this.system = new Microbe();
		this.system.build();
		this.log = [];
		this.system.container.get('logger').streams = [{
			type: 'raw', stream: new LoggerStream(this.log), raw: true
		}]
		this.system.container.get('logger').level(0);
	});
	describe('exposes operational endpoints at', function() {
		it('/__/about', function(done) {
			request(this.system.server)
				.get('/__/about')
				.expect(200)
				.expect(function(res) {
					expect(res.body).to.have.property('name')
					expect(res.body).to.have.property('description')
				})
				.end(done)
		})
		it('/__/ready', function(done) {
			request(this.system.server)
				.get('/__/ready')
				.expect(200, 'ready\n', done)
		})
		it('/__/health', function(done) {
			this.system.health('check', r => r.healthy('ok'))
			request(this.system.server)
				.get('/__/health')
				.expect(200)
				.expect(function(res) {
					expect(res.body).to.have.property('checks')
					expect(res.body).to.have.property('health')
				})
				.end(done)
		})
		it('/__/metrics', function(done) {
			request(this.system.server)
				.get('/__/metrics')
				.expect(200, done)
		})
	})
	it('sets up default instrumentation', function(done) {

		const prom = this.system.container.get('instrumentation');

		expect(()=>prom.metric('nodejs_memory_heap_used_bytes')).to.not.throw();
		expect(()=>prom.metric('nodejs_memory_heap_total_bytes')).to.not.throw();
		expect(()=>prom.metric('http_request_seconds')).to.not.throw();

		request(this.system.server)
			.get('/__/metrics')
			.expect(200)
			.expect(/nodejs_memory_heap_used_bytes/)
			.expect(/nodejs_memory_heap_total_bytes/)
			.expect(/http_request_seconds/)
			.end(done)
	})
	describe('provides a logger that   ', function() {
		it('is namespaced with app name', function() {
			expect(this.system.container.get('logger').fields).to.have.property('name', pkg.name)
		})
		it('attaches to req.logger with correlation id (id) and request id (r)', function(done) {
			this.system.route().get('/', (req, res) => {
				res.json(req.logger.fields);
			})
			request(this.system.server)
				.get('/')
				.expect(200)
				.expect(function(res) {
					expect(res.body).to.have.property('id')
					expect(res.body).to.have.property('r')
				})
				.end(done)
		})
		it('logs requests', function(done) {
			this.system.route().get('/', (req, res) => {
				res.end()
			})
			request(this.system.server)
				.get('/')
				.end(() => {
					expect(this.log[0]).to.have.deep.property('req.method', 'GET')
					expect(this.log[0]).to.have.deep.property('req.url', '/')
					done();
				})
		})
		it('logs errors with stacks and previous errors', function(done) {
			this.system.route().get('/', (req, res) => {
				const e = new Error('ERROR');
				e.previous = new Error('PREVIOUS')
				throw e;
			})
			request(this.system.server)
				.get('/')
				.end((err, res) => {
					expect(this.log[1]).to.have.deep.property('error.message', 'ERROR');
					expect(this.log[1]).to.have.deep.property('error.stack');
					expect(this.log[1]).to.have.deep.property('error.previous.message', 'PREVIOUS');
					done();
				})
		})
	})
	it('renders errors with error.status and error.message only with http status matching error.status', function(done) {
		this.system.route().get('/', (req, res) => {
			const e = error('NotFoundError', 400);
			throw new e('na-ah');
		})
		request(this.system.server)
			.get('/')
			.end((err, res) => {
				expect(res.body).to.have.property('message', 'na-ah');
				expect(res.body).to.have.property('status', 400);
				expect(res.body).to.have.property('type', 'NotFoundError');
				expect(res.body).to.have.property('reference');
				done();
			});
	});
	it('renders 500/Internal Server Error when no error.status / error.message', function(done) {
		this.system.route().get('/', (req, res) => {
			throw new Error();
		})
		request(this.system.server)
			.get('/')
			.end((err, res) => {
				expect(res.body).to.have.property('message', 'Internal Server Error');
				expect(res.body).to.have.property('status', 500);
				expect(res.body).to.have.property('type', 'Error');
				done();
			});
	});
	it('can run before() and after() middleware', function(done) {
		let result = '';
		this.system.before((req, res, next) => {
			result = result+'before.';
			next()
		})
		this.system.route().get('/', (req, res, next) => {
			result = result+'route.';
			next()
		})
		this.system.after((req, res, next) => {
			result = result+'after';
			res.end();
		})
		request(this.system.server)
			.get('/')
			.end((err, res) => {
				expect(result).to.equal('before.route.after');
				done();
			});
	})
	it('attaches a provided request ID to the request object', function(done) {
		const requestId = '79d9e89d-1b2e-4b2b-9184-b51668b223d1';
		this.system.route().get('/', (req, res) => {
			expect(req.id).to.equal(requestId);
			res.end()
		})
		request(this.system.server)
			.get('/')
			.set({'X-Request-ID': requestId})
			.expect(200, done)
	})
	it('attaches a generated request ID to the request object if one is not provided', function(done) {
		this.system.route().get('/', (req, res) => {
			expect(req.id).to.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
			res.end()
		})
		request(this.system.server)
			.get('/')
			.expect(200, done)
	})
})
