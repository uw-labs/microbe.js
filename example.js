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
	throw new Error('asd');
	res.json({ok: true});
});

service.enableErrorLog();
service.enableErrorHandler();

service.start(3031, () => {
	service.logger.info('Start callback.');
});
