module.exports = class {
	constructor(
		monitor,
		logger,
		instrumentation,
		metric,
		healthCheck,
		container
	) {
		this.container = container;
		this.monitor = monitor;
		this.logger = logger;
		this.metric = instrumentation.metric(metric);
		this.healthCheck = healthCheck;
		this.config = [];
	}

	register({serviceId, prop, type, name, isRequired, isInitiallyConnected}) {
		if (type && !this.monitor[type]) {
			throw new Error(`Could not find monitor method to handle type ${type}`);
		}

		this.config.push({serviceId, prop, type, name, isRequired, isInitiallyConnected});
	}

	start() {
		return new Promise((resolve, reject) => {
			this.config.map(c => {

				let monitored = this.container.get(c.serviceId);

				if (c.prop) {
					monitored = monitored[c.prop];
				}

				if (!monitored) {
					return reject(new Error(`Could not resolve prop ${c.prop} for component ${c.serviceId}`));
				}

				let monitorMethod = c.type;

				if (!monitorMethod) {
					monitorMethod = 'on';
				}

				let probe = this.monitor[monitorMethod](monitored).as(c.name);

				if (c.isRequired) {
					probe.required();
				}

				if (c.isInitiallyConnected) {
					probe.initiallyConnected();
				}
			})

			this.monitor.probes.map(p => {
				p.on('connected', () => {
					this.logger.info({probe: p.name}, `${p.name} connected.`)
					this.metric.set({probe: p.name}, 1)
				});
				p.on('disconnected', () => {
					this.logger.info({probe: p.name}, `${p.name} disconnected.`)
					this.metric.set({probe: p.name}, 0)
				});
				this.healthCheck.addCheck(p.name, (r) => {
					if (!p.connected && p.isRequired) {
						r.unhealthy(
							`${p.name} disconnected.`,
							`check ${p.name}.`,
							`${p.name} unavailable.`
						)
					} else if (!p.connected) {
						r.degraded(
							`${p.name} disconnected.`,
							`check ${p.name}.`
						)
					} else {
						r.healthy(`${p.name} connected.`)
					}
				});
				p.init();
			});

			resolve();
		});
	}
}
