# uw-microbe.js

Microbe is an abstraction for the repetitive task of setting basic express infrastructure each time we bring up another μService.


## API

- `new Microbe([root = process.cwd()])` - create an instance of a service passing it's name (used for loggers etc.) and root directory (for operational endpoitns etc.)
- `Microbe.build()` - builds the system, needs to be called before starting
- `Microbe.start(port)` - starts the server on given port
- `Microbe.container` - returns instance of DI container
- `Microbe.configure(configPath)` - loads yml file into canister.js configuration
- `Microbe.before(middleware)` - attaches middleware to run before any routes are evaluated
- `Microbe.after(middleware)` - attaches middleware to run after routes are evaluated
- `Microbe.route() : express.Router` - returns an instance of Router, attach your handlers here
- `Microbe.health(callback)` - adds a health checker per uw-lib-operational.js
- `Microbe.ready(callback)` - sets a ready checker per uw-lib-operational.js


## Bits out of the box

### Logging

There's both request and error logging via bunyan available out of the box.

A request scope logger, with `request-id` and `x-request-id` is available on `req.logger` property.

### Instrumentation

Available in the container via `get('instrumentation')`. Default heap and request durations are preconfigured as well as `/__/metrics` for reporter.

### Health

Endpoints exposed via default `/__/{name}` routes. You can configure your checks as described in the API section above.

### Other services

Check [wiring.yml](wiring.yml) for additional services.

### Wiring

For reference on wiring go to https://github.com/michael-donat/canister.js

### Before/After ware

Those can be added by either using your the API or tagging services with `before.router` and `after.router`.  

## Example

```nodejs
const Microbe = require('uw-microbe.js');

const system = new Microbe(__dirname);

system.configure('./wiring.yml');
system.build();

system.router.get('/', (req, res) => {
	res.json({ok: true});
})

system.pre.use((req, res, next) => {
	console.log('Some preware');
	next();
});

system.start(3321);
```
