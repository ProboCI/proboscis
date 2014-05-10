var run = require('comandante');
var es = require('event-stream');

// Constructor function.
var Penelope = function() {
  this.runCommand = this.runCommand.bind(this);
  this.createEventStream = this.createEventStream.bind(this);
  this.rawStream = es.through();
  this.eventStream = es.through();
};

// The array of running streams (wrapped by commandante.
Penelope.prototype.processStreams = [];

// The unified raw event stream of output (stdout and stderr) from all child
// processes.
Penelope.prototype.rawStream = es.through();

// The unified event stream of all running subprocesses.
// Each message is a hash with message content, command, and stream.
Penelope.prototype.eventStream = es.through();

// Run a command as a child process.
Penelope.prototype.runCommand = function() {

  // TODO: Add some arg parsing...
  if (typeof(arguments[arguments.length - 1]) === 'function') {
    var done = arguments.pop();
  }


  // Commandante provides us a full duplex stream.
  var stream = run.apply(null, arguments);
  stream.pipe(this.rawStream);
  var self = this;
  stream.on('error', function() {
    self.eventStream.end();
    if (done) {
      done();
    }
  });
  if (done) {
    stream.on('end', function() {
      done();
    });
  }
  stream
    .pipe(es.split())
    .pipe(this.createEventStream(arguments[0], 'stdout'))
    .pipe(this.eventStream);
  stream.stderr
    .pipe(es.split())
    .pipe(this.createEventStream(arguments[0], 'stderr'))
    .pipe(this.eventStream);
  this.processStreams.push(stream);
};

// Get a throughstream.
Penelope.prototype.createEventStream = function(name, streamName) {
  return es.through(function(data) {
    data = {
      message: data,
      command: name,
      stream: streamName,
    };
    this.emit('data', data);
  });
};

module.exports = Penelope;
