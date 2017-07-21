'use strict';

const should = require('should'),
  request = require('request'),
  portfinder = require('portfinder'),
  async = require('async'),
  util = require('util'),
  es = require('event-stream'),
  Readable = require('stream').Readable,
  EventEmitter = require('events').EventEmitter,
  createServer = require('../lib/server');

let Proboscis = function() {
  let _this = this;
  this.runCommand = this.runCommand.bind(this);
  this.name = 'proboscis';
  this.version = '1.0.0';
  this.eventStream = new es.through(function(data) {
    this.emit('data', data);
  });
  this.commandWasRun = false;
  this.configs = {
    'foo': {
      name: 'foo',
      command: 'test/fixtures/beeper.js',
      args: [
        "--a",
        "-b",
        "c"
      ]
    }
  };
  this.children = {
    'foo': {}
  };
};

util.inherits(Proboscis, EventEmitter);

Proboscis.prototype.setChild = function(name, child) {
  this.children[name] = child;
};
Proboscis.prototype.getConfig = function(name) {
  if (!name) return this.configs;
  return this.configs[name] || null;
};

Proboscis.prototype.getChildren = function() {
  return this.children;
};

Proboscis.prototype.runCommand = function(name, command, args, done) {
  this.commandWasRun = arguments;
  if (done) {
    done();
  }
};

let config = {
  keepAlive: true,
  log: function() {}
};
let port;

beforeEach(function(done) {
  portfinder.getPort(function(err, foundPort) {
    port = foundPort;
    done(err);
  });
});

describe('HTTP server', function() {

  describe('GET', function() {

    it('should report the version number at `/`', function(done) {
      config.port = port;
      let server = createServer(new Proboscis(), config, function() {
        request('http://localhost:' + config.port, function (error, response, body) {
          body = JSON.parse(body);
          body.name.should.equal('proboscis');
          body.version.should.equal(require('../package.json').version);
          server.close(function() {
            done();
          });
        });
      });
    });

    it('should list the running processes at `/running-processes`', function(done) {
      config.port = port;
      let server = createServer(new Proboscis, config, function() {
        request('http://localhost:' + config.port + '/running-processes', function (error, response, body) {
          body = JSON.parse(body);
          Object.keys(body).length.should.equal(1);
          body.foo.args.length.should.equal(3);
          server.close(function() {
            done();
          });
        });
      });
    });

    it('should list the logs at `/log`', function(done) {
      config.port = port;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        let logStream = request('http://localhost:' + config.port + '/log')
        logStream.pipe(es.through(function(data) {
            let output = JSON.parse(data.toString());
            output.name.should.equal('echo');
            output.stream.should.equal('stdout');
            done();
          }));
        // Wait for the client to connect, then emit a log event we can catch.
        setTimeout(function() {
          proboscis.eventStream.write({
            name: 'echo',
            command: 'echo',
            stream: 'stdout',
            time: 1415766165449
          });
        }, 10);
      });
    });
  });

  describe('DELETE', function() {

    it('should kill a process when a DELETE is sent to `/running-process/:name`', function(done) {
      config.port = port;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        proboscis.setChild('scratchy', {
          kill: function() {
            proboscis.emit('processClosed:scratchy');
            server.close();
          }
        });
        request.del('http://localhost:' + config.port + '/running-processes/scratchy', function (error, response, body) {
          JSON.parse(body).message.should.equal(util.format('Process `scratchy` stopped'));
          response.statusCode.should.equal(200);
          done(error);
        });
      });
    });

    it('should error when a DELETE is sent for a nonexistant name', function(done) {
      config.port = port;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        request.del('http://localhost:' + config.port + '/running-processes/itchy', function (error, response, body) {
          response.statusCode.should.equal(404);
          done();
        });
      });
    });

    it('should error when the process fails to exit.', function(done) {
      config.port = port;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        server.killProcessTimeout = 100;
        proboscis.setChild('scratchy', {
          kill: function() {}
        });
        request.del('http://localhost:' + config.port + '/running-processes/scratchy', function (error, response, body) {
          server.close(function() {
            JSON.parse(body).message.should.equal('Process failed to close.');
            response.statusCode.should.equal(500);
            done(error);
          });
        });
      });
    });
  });

  describe('POST', function() {

    it('should issue an error if the request is incomplete', function(done) {
      let proboscis = new Proboscis();
      config.port = port;
      let options = {
        url: 'http://localhost:' + config.port + '/running-processes/beeper',
        form: {}
      };
      let server = createServer(proboscis, config, function() {
        request.post(options, function (error, response, body) {
          response.statusCode.should.equal(400);
          server.close(done);
        });
      });
    });

    it('should run a command when post is called with a valid request', function(done) {
      let proboscis = new Proboscis();

      config.port = port;

      let options = {
        url: 'http://localhost:' + config.port + '/running-processes/beeper',
        form: {
          command: 'foo',
          args: ['-c']
        }
      };
      let server = createServer(proboscis, config, function() {
        request.post(options, function (error, response, body) {
          proboscis.commandWasRun['0'].should.equal('beeper');
          proboscis.commandWasRun['1'].should.equal('foo');
          proboscis.commandWasRun['2'].length.should.equal(1);
          proboscis.commandWasRun['2'][0].should.equal('-c');
          response.statusCode.should.equal(200);
          server.close(done);
        });
      });
    });
  });

  describe('PUT', function() {

    it('should return a 404 if the command was not already created', function(done) {
      let proboscis = new Proboscis();
      config.port = port;
      let options = {
        url: 'http://localhost:' + config.port + '/processes/no-good',
      };
      let server = createServer(proboscis, config, function() {
        request.put(options, function (error, response, body) {
          response.statusCode.should.equal(404);
          server.close(done);
        });
      });
    });

    it('should return a 201 if the command was able to start', function(done) {
      let proboscis = new Proboscis();
      config.port = port;
      let options = {
        url: 'http://localhost:' + config.port + '/processes/foo',
      };
      let commandWasRun = null;
      let server = createServer(proboscis, config, function() {
        proboscis.runCommand = function() {
          commandWasRun = arguments;
        };
        request.put(options, function (error, response, body) {
          response.statusCode.should.equal(201);
          should.exist(commandWasRun);
          commandWasRun[0].should.equal('foo');
          server.close(done);
        });
      });
    });
  });

  describe('shutdown', function() {

    it('should kill the process when the last process exits if keepalive is off', function(done) {
      config.port = port;
      config.log = function(message) {
        if (JSON.parse(message).message == 'Server successfully shutdown') {
          done();
        }
      };
      config.keepAlive = false;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        proboscis.emit('allProcessesClosed');
      });
    });

    it('should not kill the process when the last process exits if keepalive is on', function(done) {
      config.port = port;
      // We use a timeout to detect if the server would have closed by itself
      // before we kill it.
      let timedOut = false;
      config.log = function(message) {
        if (!timedOut && JSON.parse(message).message == 'Server successfully shutdown') {
          done(new Error('Server shut down'));
        }
      };
      config.keepAlive = true;
      let proboscis = new Proboscis();
      let server = createServer(proboscis, config, function() {
        proboscis.emit('allProcessesClosed');
        setTimeout(function() {
          timedOut = true;
          server.close(function() {
            done();
          });
        }, 5);
      });
    });
  });
});
