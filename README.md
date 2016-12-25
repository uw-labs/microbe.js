# uw-microbe.js

Microbe is an abstraction for the repetitive task of setting basic express infrastructure each time we bring up another μService.


## Typical example

```
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

```

## API

- `new Microbe(name, [root = process.cwd()])` - create an instance of a service passing it's name (used for loggers etc.) and root directory (for operational endpoitns etc.)
- `Microbe.name : string` - getter only, returns service name
- `Microbe.logger : Bunyan`  - getter only, returns instance of Bunyan logger
- `Microbe.server : Express` - getter only, returns an instance of express
- `Microbe.instrumentation : Prometheus` - getter only, returns an instance of uw-lib-prometheus.js
- `Microbe.auth : Provider` - getter only, returns an instance of uw-lib-auth.js/Provider
- `Microbe.start(port, [callback]) : void` - will start express app on given port, optional callback will be triggered without any arguments after the server is up
- `Microbe.enableAccessLog : void` - enables request logging to stdOut using Bunyan standard request serializer
- `Microbe.enableErrorLog : void` - enables error logging to stdErr, will log status, message and any previous exceptions in the same format
- `Microbe.enableAuth(Provider) : void` - enables authentication middleware, accepts a configured instance of uw-lib-auth.js/Provider
- `Microbe.enableErrorHandler : void` - enables rendering of Errors back to the client as a {status, message} JSON string
- `Microbe.operational : {health, about, ready}` - returns bridge to operational checks

## Logging

### Correlation via request scoped logger.

Each request object gets a child logger in the `req.logger` property. The fixed header carries a unique, per request generated uuid.v4 in the `r` field as well as a `x-request-id` header value in the `id` field (if available).

### Access log

Access logs are generated via Bunyan.stdSerializers.req serializer and are pumped into stdOut.

### Error log

Error logs use customer serialization where only message and status are plucked. If there's a `previous` property on an error, it will be serialized using the same format and attached to the log line. Error logs are pumped on stdErr.

## Authenticaton

Microbe provides simple bridging into uw-lib-auth, for specifics refer to uw-lib-auth documentation.

## Operational endpoints

Microbe provides preconfigured bridging into uw-lib-operational, for specifics refer to uw-lib-auth documentation. Standard preconfiguration will try to read details from package.json (failing silently) and derive information from it (name, description, author, links etc), will also try to read `build.json` file looking for build information. 


## Error middleware

Both `enableErrorLog` and `enableErrorHandler` call `next(error)` to trigger another middleware in the stack. To prevent express from printing error object on stdOut and allow to further chain error middleware at the same time, Microbe adds a dummy error handler before the server starts.
