var util = require('util');
var spawn = require('child_process').spawn;
var EventEmitter = require('events').EventEmitter;
var split2 = require('split2');
var through2 = require('through2');

/**
 * Constructor function.
 */
var Proboscis = function() {
  this.runCommand = this.runCommand.bind(this);
  this.runConfiguredProcesses = this.runConfiguredProcesses.bind(this);
  this.createEventStream = this.createEventStream.bind(this);
  this.getChildren = this.getChildren.bind(this);
  this.rawStream = through2();
  this.rawStream.setMaxListeners(0);
  this.eventStream = through2.obj();
  this.eventStream.setMaxListeners(0);
  this.processes = {};
  this.processConfigs = {};
  this.closeStreamWithLastProcess = true;
  this.setMaxListeners(0);
};
util.inherits(Proboscis, EventEmitter);

// The hash of running child processes.
Proboscis.prototype.processes = {};

// The hash of running streams.
Proboscis.prototype.processStreams = {};

// The hash of process configurations.
Proboscis.prototype.processConfigs = {};

// The unified raw event stream of output (stdout and stderr) from all child
// processes.
Proboscis.prototype.rawStream = null;

// The unified event stream of all running subprocesses.
// Each message is a hash with message content, command, and stream.
Proboscis.prototype.eventStream = null;

// Whether to close the event stream with the final process.
Proboscis.prototype.closeStreamWithLastProcess = true;

/**
 * Run a command as a child process.
 *
 * @param {string} name A unique name for this command.
 *     Useful for differentiating two instances of the same executable.
 * @param {string} command The command to run as a subprocess.
 * @param {Array} args Optional arguments to be passed to the command.
 * @param {Object} options Optional hash passed through to child_process.
 * @param {Function} done Optional callback to run when the child process exits.
 */
Proboscis.prototype.runCommand = function(name, command, args, done) {

  // Convert args to an array so that it's easier to work with.
  arguments = Array.prototype.slice.call(arguments, 0);
  if (typeof arguments[arguments.length - 1] === 'function') {
    done = arguments.pop();
  }
  name = arguments.shift();

  var child = spawn.apply(null, arguments);

  this.processes[name] = child;
  this.addProcess(name, command, args);

  // Add stdout and stderr to our unified raw stream.
  child.stdout.pipe(this.rawStream);
  child.stderr.pipe(this.rawStream);

  // Bind for event processing for our done callback if we have any.
  if (done) {
    child.on('error', done);
    child.on('exit', function(code) {
      var error = null;
      if (code !== 0 && code !== false) {
        var string = 'Execution of command %s named %s exited with code %s';
        error = new Error(util.format(string, command, name, code));
      }
      done(error);
    });
  }

  child.stdout
    .pipe(split2())
    .pipe(this.createEventStream(name, command, 'stdout'))
    .pipe(this.eventStream, {end: this.closeStreamWithLastProcess});

  child.stderr
    .pipe(split2())
    .pipe(this.createEventStream(name, command, 'stderr'))
    .pipe(this.eventStream, {end: this.closeStreamWithLastProcess});
};

/**
 * Return the hash of running child processes.
 */
Proboscis.prototype.getChildren = function() {
  return this.processes;
};

/**
 * Return the currint process configurations.
 */
Proboscis.prototype.getConfig = function(name) {
  if (name !== undefined) {
    if (this.processConfigs.hasOwnProperty(name)) {
      return this.processConfigs[name];
    }
    return null;
  }
  return this.processConfigs;
};

/**
 * Add a process configuration.
 */
Proboscis.prototype.addProcess = function(name, command, args, autoStart) {
  var start = autoStart || true;
  this.processConfigs[name] = {
    name: name,
    command: command,
    args: args,
    start: start
  };
};

/**
 * Run all currently configured processes that are configured to start.
 */
Proboscis.prototype.runConfiguredProcesses = function() {
  var i = null;
  var config = null;
  for (i in this.processConfigs) {
    config = this.processConfigs[i];
    if (config.start) {
      this.runCommand(config.name, config.command, config.args);
    }
  }
};

/**
 * Get a throughstream that wraps all data passed through.
 *
 * @param {string} name A unique name for this event stream.
 * @param {string} command The name of the command.
 * @param {string} streamName The name of this stream (e.g. stdout or stderr).
 * @return {stream} A throughstream that wraps string input.
 */
Proboscis.prototype.createEventStream = function(name, command, streamName) {
  var _this = this;
  this.processStreams[name + ':' + streamName] = through2.obj(function(data, enc, cb) {
    if (data == '') {
      return cb();
    }
    data = {
      name: name,
      command: command,
      message: data,
      stream: streamName,
      time: new Date().getTime()
    };
    this.push(data);
    cb();
  },
  // Don't end our event stream until all of the child processes have exited.
  function() {
    delete _this.processStreams[name + ':' + streamName];
    if (Object.keys(_this.processStreams).length === 0) {
      this.emit('end');
    }
    if (!_this.processStreams[name + ':stdout'] && !_this.processStreams[name + ':stderr']) {
      delete _this.processes[name];
      _this.emitEndEvent(name);
    }
  });
  return this.processStreams[name + ':' + streamName];
};

/**
 * Emits the end event once there are no running child processes.
 *
 * @param {string} name The name of the process that has closed.
 */
Proboscis.prototype.emitEndEvent = function(name) {
  this.emit('processClosed', name);
  this.emit('processClosed:' + name, name);
  if (Object.keys(this.processes).length === 0) {
    this.emit('allProcessesClosed');
  }
};

module.exports = Proboscis;
