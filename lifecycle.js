const eachSeries = require('async.eachseries');

module.exports = class SystemLifecycle {
	constructor() {
		this.startMethods = [];
		this.stopMethods = [];

	}

	_getMethod(method, context) {
		if (typeof (method) == 'string') {
			if (!context || !context[method]) {
				throw new Error(`Unable to locate start/stop method ${method}`);
			}
			return context[method];
		}

		return method;
	}

	registerStart(priority, method, context) {
		this.startMethods.push({
			priority,
			method: this._getMethod(method, context),
			context
		})
	}

	registerStop(priority, method, context) {
		this.stopMethods.push({
			priority,
			method: this._getMethod(method, context),
			context
		})
	}

	start() {
		return new Promise((resolve, reject) => {
			eachSeries(
				this.startMethods.sort((a, b) => a.priority - b.priority),
				({method, context}, callback) => {
					method.apply(context || null)
						.then(()=>callback())
						.catch(callback);
				}, (err) => err ? reject(err) : resolve()
			);
		})
	}

	stop() {
		return new Promise((resolve, reject) => {
			eachSeries(
				this.stopMethods.sort((a, b) => a.priority - b.priority).reverse(),
				({method, context}, callback) => {
					method.apply(context || null)
						.then(()=>callback())
						.catch(callback);
				}, (err) => err ? reject(err) : resolve()
			);
		})
	}
}
