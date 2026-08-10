# Proboscis

Run several child processes at once and get a single, structured JSON event stream describing everything they print.

Instead of interleaved, unattributable console noise, every line of output becomes a discrete JSON event tagged with which process produced it, whether it came from stdout or stderr, and when:

```json
{"name":"api","command":"node","message":"listening on 8080","stream":"stdout","time":1786405462254}
{"name":"worker","command":"php","message":"PHP Notice: undefined index","stream":"stderr","time":1786405462255}
```

Proboscis can be used as a library, as a command line tool, or as a long-running supervisor with an HTTP control API.

## Why use it

**One log stream out of many processes.** The classic problem with running more than one process in a container is that their output collides on the same file descriptors. Proboscis splits each child's output line by line and labels it, so a single stream stays fully demultiplexable downstream.

**stdout and stderr stay distinguishable.** Both are captured, and every event records which one it came from — so you can keep them in one ordered stream without losing the distinction, and filter later.

**Structured, not scraped.** Output is line-delimited JSON. Ship it straight to a log aggregator, filter it with `jq`, or pipe it through the bundled formatter for human-readable colored output.

**Control processes while they run.** Start it with a port and you get a small REST API to list, start, stop, and restart child processes, and to tail the live event stream — useful when you can't easily get a shell into the environment.

**Small dependency surface.** The HTTP control server is built on Node's own `http` module. No web framework.

It was built for [ProboCI](https://github.com/ProboCI/probo) to supervise processes inside Docker containers, but nothing about it is Probo-specific.

## Requirements

Node.js 22 or newer, as declared in `engines`. The test suite is verified against Node 22 and 24 (and still passes on 20).

## Install

```bash
npm install proboscis
```

Install globally, or use `npx`, if you want the command line tools on your `PATH`:

```bash
npm install -g proboscis
```

## Library usage

```js
const Proboscis = require('proboscis');

const runner = new Proboscis();

// Consume the unified event stream (an object-mode stream).
runner.eventStream.on('data', function(event) {
  console.log(`[${event.name}/${event.stream}] ${event.message}`);
});

runner.runCommand('api', 'node', ['server.js']);
runner.runCommand('worker', 'php', ['worker.php']);

runner.on('allProcessesClosed', function() {
  console.log('everything exited');
});
```

### The event object

Each line written by a child becomes one event:

| Field | Description |
| --- | --- |
| `name` | The name you gave the process in `runCommand()`. |
| `command` | The executable that was run. |
| `message` | A single line of output, with the newline stripped. |
| `stream` | Either `stdout` or `stderr`. |
| `time` | Milliseconds since the epoch, as an integer. |

Blank lines are dropped rather than emitted as empty events.

### API

#### `new Proboscis()`

Creates a runner. Extends `EventEmitter`.

#### `runCommand(name, command, [args], [options], [done])`

Spawns `command` as a child process and begins piping its output into the event stream. `name` is an arbitrary label used to tag the resulting events — give two instances of the same executable different names to tell them apart.

`args` and `options` are passed through to `child_process.spawn()`, so `options` accepts `cwd`, `env`, and the rest.

`done` is an optional callback invoked when the process exits. It receives an `Error` if the process failed to spawn or exited non-zero, and `null` otherwise:

```js
runner.runCommand('migrate', 'npm', ['run', 'migrate'], function(error) {
  if (error) return console.error('migration failed:', error.message);
  runner.runCommand('api', 'node', ['server.js']);
});
```

#### `addProcess(name, command, [args])`

Registers a process configuration without starting it. Use with `runConfiguredProcesses()` to define a set of processes up front and launch them together.

> The fourth `autoStart` parameter is currently ignored — configurations are always recorded as startable.

#### `runConfiguredProcesses()`

Starts every registered configuration.

#### `getChildren()`

Returns an object mapping process names to their live `ChildProcess` instances. Use it to signal a child directly:

```js
runner.getChildren()['worker'].kill();
```

Processes are removed from this object once they exit.

#### `getConfig([name])`

With a name, returns that process's configuration, or `null` if unknown. With no argument, returns every configuration. Unlike `getChildren()`, configurations persist after a process exits, which is what makes restarting it possible.

### Streams

#### `eventStream`

An object-mode stream of the event objects described above. This is the main output.

#### `rawStream`

The unparsed, unlabelled bytes from every child's stdout and stderr, combined. Useful if you want the original output verbatim.

#### `closeStreamWithLastProcess`

Defaults to `true`, ending `eventStream` and `rawStream` once the last child exits. Set it to `false` when you intend to start more processes later and want the stream to stay open:

```js
runner.closeStreamWithLastProcess = false;
```

### Events

| Event | Fires when |
| --- | --- |
| `processClosed` | Any process exits. Receives the process name. |
| `processClosed:<name>` | The named process exits. |
| `allProcessesClosed` | The last running process exits. |

## Command line usage

### `proboscis`

Run one or more commands and emit the JSON event stream on stdout:

```bash
proboscis -c "node server.js" -c "php worker.php"
```

Each `-c` is quoted and parsed as a shell-style command line. By default a process is named after its executable; pass `-n` to name them explicitly, in the same order:

```bash
proboscis -c "node server.js" -n api -c "node server.js" -n admin
```

| Option | Description |
| --- | --- |
| `-c`, `--command` | A command to run. Repeatable. |
| `-n`, `--name` | Name for the command in the same position. Repeatable. |
| `-p`, `--port` | Port for the HTTP control server. Omit to disable it. |
| `-k`, `--keep-alive` | Keep the server running after every process has exited. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Print the version. |

Without `--keep-alive`, the process exits once all children have exited. With it, the control server stays up so you can start processes again later.

### `proboscis-format`

Turn the JSON stream into readable, colored lines:

```bash
proboscis -c "node server.js" -c "php worker.php" | proboscis-format
```

```
[07/12/58578-09:12:54 api stdout] listening on 8080
[07/12/58578-09:12:54 worker stderr] PHP Notice: undefined index
```

> **Known issue:** the timestamp above is wrong. The formatter's template renders the event's millisecond `time` value as though it were seconds, so the date component is nonsense. The process name, stream, and message are correct. Consume the raw JSON if you need reliable timestamps.

| Option | Description |
| --- | --- |
| `-n`, `--name` | Only show events from this process. |
| `-s`, `--stream` | Only show `stdout` or `stderr`. |
| `-c`, `--color` | Colorize output. On by default; `--color false` disables it. |

Because the underlying stream is just JSON, `jq` works equally well:

```bash
proboscis -c "node server.js" | jq -r 'select(.stream == "stderr") | .message'
```

### `proboscis-control`

Talk to a running Proboscis that was started with `--port`:

```bash
proboscis --port 3020 --keep-alive -c "node server.js" -n api
```

```bash
proboscis-control --port 3020 list
proboscis-control --port 3020 stop api
proboscis-control --port 3020 start api
proboscis-control --port 3020 restart api
proboscis-control --port 3020 log
proboscis-control --port 3020 run migrate -c "npm run migrate"
```

| Subcommand | Description |
| --- | --- |
| `list` | Show the running processes and their configurations. |
| `start <name>` | Start a configured process that isn't running. |
| `stop <name>` | Kill a running process. |
| `restart <name>` | Stop a process and start it again from its stored configuration. |
| `run <name> -c "<cmd>"` | Start a brand new process under the given name. |
| `log` | Stream live events until interrupted. |

| Option | Description |
| --- | --- |
| `-p`, `--port` | Port to connect to. Required. |
| `-H`, `--host` | Host to connect to. Defaults to `localhost`. |
| `-c`, `--command` | The command to run, for use with `run`. |

`start` and `restart` rely on a stored configuration, so they only work for processes Proboscis already knows about. Use `run` to introduce a new one.

## HTTP control API

Starting `proboscis` with `--port` exposes these endpoints directly, so you aren't limited to the bundled client.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Returns the service name and version. |
| `GET` | `/log` | Streams live events as newline-free concatenated JSON objects. Never ends on its own. |
| `GET` | `/running-processes` | Returns configurations for every currently running process. |
| `POST` | `/running-processes/:name` | Starts a new process. Body: `{"command": "node", "args": ["server.js"]}`. Returns `400` if `command` is missing. |
| `DELETE` | `/running-processes/:name` | Kills the named process. Returns `404` if it isn't running, or `500` if it doesn't die within `killProcessTimeout` (3s). |
| `PUT` | `/processes/:name` | Starts a process from its stored configuration. Returns `201`, or `404` if no such configuration exists. |

Note the distinction: `/running-processes` addresses processes that are up right now, while `/processes` addresses stored configurations.

```bash
curl -s localhost:3020/running-processes | jq
curl -s -X POST localhost:3020/running-processes/migrate \
  -H 'Content-Type: application/json' \
  -d '{"command":"npm","args":["run","migrate"]}'
```

### Embedding the server

The server can wrap a Proboscis instance in your own program:

```js
const Proboscis = require('proboscis');
const createServer = require('proboscis/lib/server');

const runner = new Proboscis();
runner.closeStreamWithLastProcess = false;

const server = createServer(runner, {port: 3020, keepAlive: true}, function() {
  console.log('control server ready');
});
```

The config object takes `port`, `keepAlive`, and an optional `log` function (defaults to `console.log`). When `keepAlive` is false, the server shuts itself down after the last process exits. `server.close()` also tears down any open `/log` streams so the process can exit cleanly.

## Configuration files

`proboscis` and `proboscis-control` both read `/etc/proboscis.yaml` and `~/.proboscis.yaml` if present. Missing files are ignored.

```yaml
port: 3020
```

This is most useful for `proboscis-control`, letting you drop the repeated `--port`:

```bash
proboscis-control list
```

Two limitations worth knowing:

- Only settings without a command line default can be supplied this way. `port` works; `keepAlive` does not, because the flag's default is merged last and overrides the file. Pass `--keep-alive` on the command line.
- Process definitions cannot be declared in these files. Commands come from `-c` flags or the HTTP API.

## Development

```bash
npm test          # run the mocha suite
npm run watch     # re-run on change
npm run coverage  # run with nyc coverage
npx mocha test/testRunCommands.js   # a single file
```

## Why the name

Proboscis is the part of [probo](http://github.com/ProboCI/probo) that runs inside the Docker container. The proboscis is the part of the mosquito that pokes into your skin. We probably could have come up with a less itchy analogy.

## License

GPL-2.0
