const Microbe = require('.');

const service = new Microbe('uw-microbe-example');

service.enableAccessLog();

service.enableAuth(
	new service.auth.Provider([
		new service.auth.Method.oAuth2JWT({
			key: process.env.AUTH_KEY_FILE
				? service.auth.Key.fromFile(process.env.AUTH_KEY_FILE)
				: service.auth.Key.fromString(process.env.AUTH_KEY)
		})
	])
);

service.server.get('/ok', (req, res) => {
	res.json({ok: true});
});

service.server.get('/error', (req, res) => {
	throw new Error('Example error');
});

service.enableErrorLog();
service.enableErrorHandler();

service.operational.health.addCheck('API', (r) => r.healthy('API available.'));

service.start(3031, () => {
	service.logger.info('Start callback.');
});
