# uw-microbe.js

<p align="center">
  <img src="https://raw.githubusercontent.com/utilitywarehouse/uw-microbe.js/master/logo.jpg" alt="microbe.js"/>
</p>

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
- `Microbe.bootstrap() : Promise` - runs bootstrap methods (if any) in order and returns Promise
- `Microbe.teardown() : Promise` - runs teardown methods (if any) in reverse order and returns Promise


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

## System lifecycle

It is possible to define startup and shutdown methods via container configuration. Microbe exposes `bootstrap` and `teardown` methods to trigger the behaviour.

Definition:

```yml
components:
  mysql:
    module: './mysql'
    tags:
      system.start: ~
  redis:
    module: './redis'
    tags:
      system.start: 2
  mongo:
    class: './mongo'
    tags:
      system.start: {method: start, priority: 3}
      system.stop: {method: stop}
```

- `myssql` will be with priority 0 and the startup method will be the one returned from the module (`require('./mysql')()`)
- `redis` will be started with priority 2 and the startup method will be the one returned from the module (as above)
- `mongo` will be started with priority 3 and the startup method will be `start` executed in `mongo` context (no constructor manual needed, `this` will be `mongo`)
- `mongo` will shutdown with priority 0 (reverse order), method is `stop` bound to `mongo`

Order is **NOT** guaranteed if two services have the same priority.
 
Start/Stop methods are executed in series, **always**. 

Provided start/stop methods are **required** to return a promise.

Where a start/stop method rejects the entire chain will be rejected.

## Behaviour

```
  Microbe
    ✓ sets up default instrumentation
    ✓ renders errors with error.status and error.message only with http status matching error.status
    ✓ renders 500/Internal Server Error when no error.status / error.message
    ✓ can run before() and after() middleware
    exposes operational endpoints at
      ✓ /__/about
      ✓ /__/ready
      ✓ /__/health
      ✓ /__/metrics
    provides a logger that
      ✓ is namespaced with app name
      ✓ attaches to req.logger with correlation id (id) and request id (r)
      ✓ logs requests
      ✓ logs errors with stacks and previous errors

```
