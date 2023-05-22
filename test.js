const stream = require("stream");
const chai = require("chai");
const request = require("supertest");
const Microbe = require(".");
const expect = chai.expect;
const pkg = require("./package.json");
const error = require("@utilitywarehouse/uw-lib-error.js");
const logger = require("@utilitywarehouse/uw-lib-logger.js");
const fs = require('fs');

class LoggerStream extends stream.Writable {
	constructor(data) {
		super({ objectMode: true });
		this.data = data;
	}

	_write(chunk, encoding, next) {
		this.data.push(chunk);
		next();
	}
}

describe("Microbe", function () {
	beforeEach(function () {
		this.system = new Microbe();
		this.system.build();
		this.system.container.get("logger").level = 'silent';
	});

	describe("exposes operational endpoints at", function () {
		it("/__/about", function (done) {
			request(this.system.server)
				.get("/__/about")
				.expect(200)
				.expect(function (res) {
					expect(res.body).to.have.property("name");
					expect(res.body).to.have.property("description");
				})
				.end(done);
		});

		it("/__/ready", function (done) {
			request(this.system.server).get("/__/ready").expect(200, "ready\n", done);
		});

		it("/__/health", function (done) {
			this.system.health("check", (r) => r.healthy("ok"));
			request(this.system.server)
				.get("/__/health")
				.expect(200)
				.expect(function (res) {
					expect(res.body).to.have.property("checks");
					expect(res.body).to.have.property("health");
				})
				.end(done);
		});

		it("/__/metrics", function (done) {
			request(this.system.server).get("/__/metrics").expect(200, done);
		});
	});

	it("sends security headers", function (done) {
		request(this.system.server)
			.get("/__/about")
			.expect(200)
			.expect(function (res) {
				const headers = res.headers;

				expect(headers["x-dns-prefetch-control"]).to.equal(
					"off",
					"x-dns-prefetch-control"
				);
				expect(headers["x-frame-options"]).to.equal(
					"SAMEORIGIN",
					"x-frame-options"
				);
				expect(headers["x-powered-by"]).to.equal(undefined, "x-powered-by");
				expect(headers["strict-transport-security"]).to.equal(
					"max-age=15552000; includeSubDomains",
					"strict-transport-security"
				);
				expect(headers["x-download-options"]).to.equal(
					"noopen",
					"x-download-options"
				);
				expect(headers["x-content-type-options"]).to.equal(
					"nosniff",
					"x-content-type-options"
				);
				expect(headers["x-xss-protection"]).to.equal("0");
			})
			.end(done);
	});

	it("sets up default instrumentation", function (done) {
		const prom = this.system.container.get("instrumentation");

		expect(() => prom.metric("nodejs_memory_heap_used_bytes")).to.not.throw();
		expect(() => prom.metric("nodejs_memory_heap_total_bytes")).to.not.throw();
		expect(() => prom.metric("http_request_seconds")).to.not.throw();

		request(this.system.server)
			.get("/__/metrics")
			.expect(200)
			.expect(/nodejs_memory_heap_used_bytes/)
			.expect(/nodejs_memory_heap_total_bytes/)
			.expect(/http_request_seconds/)
			.end(done);
	});

	describe("provides a logger that   ", function () {
		beforeEach(async function () {
			if (fs.existsSync('./test.log')) {
				await fs.unlinkSync('./test.log');
			}

			this.system = new Microbe();
			const inj = logger({
				name: pkg.name,
				level: 'trace',
				transport: {
					targets: [
						{
							level: 'trace',
							target: 'pino/file',
							options: { destination: './test.log', sync: true }
						},
					]
				}
			})
			this.system.di.inject('logger', inj)
			this.system.build();
		})

		it("is namespaced with app name", function () {
			expect(this.system.container.get("logger").bindings()).to.have.property(
				"name",
				pkg.name
			);
		});

		it("attaches to req.logger with correlation id (id) and request id (r)", function (done) {
			this.system.route().get("/logger", (req, res) => {
				res.json(req.logger.bindings());
			});
			request(this.system.server)
				.get("/logger")
				.expect(200)
				.expect(function (res) {
					expect(res.body).to.have.property("id");
					expect(res.body).to.have.property("r");
				})
				.end(function () {
					setTimeout(done, 100);
				});
		});

		it("logs requests", function (done) {
			this.system.route().get("/request", (req, res) => {
				res.end();
			});
			request(this.system.server)
				.get("/request")
				.end(function () {
					setTimeout(() => { // pino writes async; wait for file to be complete
						fs.readFile("./test.log", "utf-8", (err, data) => {
							const log = JSON.parse(data)
							expect(log.req.method).to.eql("GET")
							expect(log.req.url).to.eql("/request");
							done();
						})
					}, 100);
				});
		});

		it("logs errors with stacks and previous errors", function (done) {
			this.system.route().get("/errors", (req, res) => {
				const e = new Error("ERROR");
				e.previous = new Error("PREVIOUS");
				throw e;
			});
			request(this.system.server)
				.get("/errors")
				.end((err, res) => {
					setTimeout(() => { // pino writes async; wait for file to be complete
						fs.readFile("./test.log", "utf-8", (err, data) => {
							const log = data.split("\n").filter(t => t).map(JSON.parse)

							expect(log[1].error.message).to.eql("ERROR");
							expect(log[1].error).to.have.property("stack");
							expect(log[1].error.previous.message).to.eql("PREVIOUS");
							done();
						})
					}, 100);
				});
		});
	});

	it("renders errors with error.status and error.message only with http status matching error.status", function (done) {
		this.system.route().get("/notFound", (req, res) => {
			const e = error("NotFoundError", 400);
			throw new e("na-ah");
		});
		request(this.system.server)
			.get("/notFound")
			.end((err, res) => {
				expect(res.body).to.have.property("message", "na-ah");
				expect(res.body).to.have.property("status", 400);
				expect(res.body).to.have.property("type", "NotFoundError");
				expect(res.body).to.have.property("reference");
				done();
			});
	});

	it("renders 500/Internal Server Error when no error.status / error.message", function (done) {
		this.system.route().get("/internal", (req, res) => {
			throw new Error();
		});
		request(this.system.server)
			.get("/internal")
			.end((err, res) => {
				expect(res.body).to.have.property("message", "Internal Server Error");
				expect(res.body).to.have.property("status", 500);
				expect(res.body).to.have.property("type", "Error");
				done();
			});
	});

	it("can run before() and after() middleware", function (done) {
		let result = "";
		this.system.before((req, res, next) => {
			result = result + "before.";
			next();
		});
		this.system.route().get("/route", (req, res, next) => {
			result = result + "route.";
			next();
		});
		this.system.after((req, res, next) => {
			result = result + "after";
			res.end();
		});
		request(this.system.server)
			.get("/route")
			.end((err, res) => {
				expect(result).to.equal("before.route.after");
				done();
			});
	});

	it("attaches a provided request ID to the request object", function (done) {
		const requestId = "79d9e89d-1b2e-4b2b-9184-b51668b223d1";
		this.system.route().get("/provided-id", (req, res) => {
			expect(req.id).to.equal(requestId);
			res.end();
		});
		request(this.system.server)
			.get("/provided-id")
			.set({ "X-Request-ID": requestId })
			.expect(200, done);
	});

	it("attaches a generated request ID to the request object if one is not provided", function (done) {
		this.system.route().get("/gen-id", (req, res) => {
			expect(req.id).to.match(
				/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
			);
			res.end();
		});
		request(this.system.server).get("/gen-id").expect(200, done);
	});
});
