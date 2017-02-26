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

## Monitoring

Microbe can monitor your infrastructure connections and have state pumped onto logger, instrumentation and health endpoints. 
There are only two types of events recognised, `connected` and `disconnected` and any instance provided for monitoring is required to raise those. 
Patch methods for redis and mongo are available and will translate events to the required pair. The endpoint patch method will translate `available` and `unavailable` events.

Definition:

```yml
components:
  redis:
    module: './redis'
    tags:
      system.start: 2
      system.monitor:
        type: redis
        prop: cache
        initiallyConnected: true
  mongo:
    class: './mongo'
    tags:
      system.start: {method: start, priority: 3}
      system.stop: {method: stop}
      system.monitor:
        type: mongo
        prop: db
        required: true
        initiallyConnected: true
```

Syntax:

- `type` - optional, endpoint, redis or mongo, if left blank it will try to monitor connected/disconnected events on passed instance
- `prop` - optional, the prop of the service where the events are emitted from, this is required  because we often have wrappers around connection objects
- `name` - optional, arbitrary name, will be used as label in any output type - defaults to component definition id (service name)
- `required` - optional, if set to true and connection is down it will report system as unhealthy in health checks, default is false
- `initiallyConnected` - optional, it will set the probe to connected after creation, this is because a lot of the connection objects do not emit connection events, default is true

### Endpoint monitoring

HTTP endpoint monitoring is available via the https://github.com/utilitywarehouse/uw-lib-endpoint-monitor.js package - please refer to the package documentation for specifics. 

Definition:

```yml
components:
  someApi:
    factory: 'axios.create'
    with:
      - baseURL: 'http://api.example.com'
  endpoint.monitor.someAPI:
    factory: '@utilitywarehouse/uw-lib-endpoint-monitor.js'
    with:
        - client: '@someApi'
    tags:
      system.monitor:
        type: endpoint
        name: someApi
```

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
