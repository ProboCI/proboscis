'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const split2 = require('split2');
const through2 = require('through2');

class Proboscis extends EventEmitter {
  constructor() {
    super();
    this.runCommand = this.runCommand.bind(this);
    this.runConfiguredProcesses = this.runConfiguredProcesses.bind(this);
    this.createEventStream = this.createEventStream.bind(this);
    this.getChildren = this.getChildren.bind(this);
    this.rawStream = through2();
    this.rawStream.setMaxListeners(0);
    this.eventStream = through2.obj();
    this.eventStream.setMaxListeners(0);
    this.processes = {};
    this.processStreams = {};
    this.processConfigs = {};
    this.closeStreamWithLastProcess = true;
    this.setMaxListeners(0);
  }

  /**
   * Run a command as a child process.
   *
   * @param {string} name A unique name for this command.
   *     Useful for differentiating two instances of the same executable.
   * @param {string} command The command to run as a subprocess.
   * @param {Array} args Optional arguments to be passed to the command.
   * @param {Function} done Optional callback to run when the child process exits.
   */
  runCommand(name, command, args, done) {
    // Convert args to an array so that it's easier to work with.
    const spawnArgs = Array.prototype.slice.call(arguments, 0);
    if (typeof spawnArgs[spawnArgs.length - 1] === 'function') {
      done = spawnArgs.pop();
    }
    name = spawnArgs.shift();

    const child = spawn.apply(null, spawnArgs);

    this.processes[name] = child;
    this.addProcess(name, command, args);

    // Add stdout and stderr to our unified raw stream.
    child.stdout.pipe(this.rawStream);
    child.stderr.pipe(this.rawStream);

    // Bind for event processing for our done callback if we have any.
    if (done) {
      child.on('error', done);
      child.on('exit', function(code) {
        let error = null;
        if (code !== 0 && code !== false) {
          const string = 'Execution of command %s named %s exited with code %s';
          error = new Error(require('util').format(string, command, name, code));
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
  }

  /**
   * Return the hash of running child processes.
   */
  getChildren() {
    return this.processes;
  }

  /**
   * Return the current process configurations.
   */
  getConfig(name) {
    if (name !== undefined) {
      if (this.processConfigs.hasOwnProperty(name)) {
        return this.processConfigs[name];
      }
      return null;
    }
    return this.processConfigs;
  }

  /**
   * Add a process configuration.
   */
  addProcess(name, command, args, autoStart) {
    const start = autoStart || true;
    this.processConfigs[name] = {
      name: name,
      command: command,
      args: args,
      start: start,
    };
  }

  /**
   * Run all currently configured processes that are configured to start.
   */
  runConfiguredProcesses() {
    for (const i in this.processConfigs) {
      const config = this.processConfigs[i];
      if (config.start) {
        this.runCommand(config.name, config.command, config.args);
      }
    }
  }

  /**
   * Get a throughstream that wraps all data passed through.
   *
   * @param {string} name A unique name for this event stream.
   * @param {string} command The name of the command.
   * @param {string} streamName The name of this stream (e.g. stdout or stderr).
   * @return {stream} A throughstream that wraps string input.
   */
  createEventStream(name, command, streamName) {
    const _this = this;
    this.processStreams[name + ':' + streamName] = through2.obj(function(data, enc, cb) {
      if (data === '') {
        return cb();
      }
      data = {
        name: name,
        command: command,
        message: data,
        stream: streamName,
        time: new Date().getTime(),
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
  }

  /**
   * Emits the end event once there are no running child processes.
   *
   * @param {string} name The name of the process that has closed.
   */
  emitEndEvent(name) {
    this.emit('processClosed', name);
    this.emit('processClosed:' + name, name);
    if (Object.keys(this.processes).length === 0) {
      this.emit('allProcessesClosed');
    }
  }
}

module.exports = Proboscis;
