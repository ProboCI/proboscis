'use strict';

const should = require('should');
const portfinder = require('portfinder');
const util = require('util');
const es = require('event-stream');
const { EventEmitter } = require('events');
const createServer = require('../lib/server');

class Proboscis extends EventEmitter {
  constructor() {
    super();
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
          "c",
        ],
      },
    };
    this.children = {
      'foo': {},
    };
  }

  setChild(name, child) {
    this.children[name] = child;
  }

  getConfig(name) {
    if (!name) return this.configs;
    return this.configs[name] || null;
  }

  getChildren() {
    return this.children;
  }

  runCommand(name, command, args, done) {
    this.commandWasRun = arguments;
    if (done) {
      done();
    }
  }
}

const config = {
  keepAlive: true,
  log: function() {},
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
      const server = createServer(new Proboscis(), config, function() {
        fetch('http://localhost:' + config.port).then(async function(response) {
          const body = await response.json();
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
      const server = createServer(new Proboscis(), config, function() {
        fetch('http://localhost:' + config.port + '/running-processes').then(async function(response) {
          const body = await response.json();
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
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
        fetch('http://localhost:' + config.port + '/log').then(async function(response) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const result = await reader.read();
          const output = JSON.parse(decoder.decode(result.value));
          output.name.should.equal('echo');
          output.stream.should.equal('stdout');
          done();
        });
        // Wait for the client to connect, then emit a log event we can catch.
        setTimeout(function() {
          proboscis.eventStream.write({
            name: 'echo',
            command: 'echo',
            stream: 'stdout',
            time: 1415766165449,
          });
        }, 10);
      });
    });
  });

  describe('DELETE', function() {

    it('should kill a process when a DELETE is sent to `/running-process/:name`', function(done) {
      config.port = port;
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
        proboscis.setChild('scratchy', {
          kill: function() {
            proboscis.emit('processClosed:scratchy');
            server.close();
          },
        });
        fetch('http://localhost:' + config.port + '/running-processes/scratchy', {
          method: 'DELETE',
        }).then(async function(response) {
          const body = await response.json();
          body.message.should.equal(util.format('Process `scratchy` stopped'));
          response.status.should.equal(200);
          done();
        });
      });
    });

    it('should error when a DELETE is sent for a nonexistant name', function(done) {
      config.port = port;
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
        fetch('http://localhost:' + config.port + '/running-processes/itchy', {
          method: 'DELETE',
        }).then(function(response) {
          response.status.should.equal(404);
          server.close(done);
        });
      });
    });

    it('should error when the process fails to exit.', function(done) {
      config.port = port;
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
        server.killProcessTimeout = 100;
        proboscis.setChild('scratchy', {
          kill: function() {},
        });
        fetch('http://localhost:' + config.port + '/running-processes/scratchy', {
          method: 'DELETE',
        }).then(async function(response) {
          const body = await response.json();
          server.close(function() {
            body.message.should.equal('Process failed to close.');
            response.status.should.equal(500);
            done();
          });
        });
      });
    });
  });

  describe('POST', function() {

    it('should issue an error if the request is incomplete', function(done) {
      const proboscis = new Proboscis();
      config.port = port;
      const server = createServer(proboscis, config, function() {
        fetch('http://localhost:' + config.port + '/running-processes/beeper', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({}),
        }).then(function(response) {
          response.status.should.equal(400);
          server.close(done);
        });
      });
    });

    it('should run a command when post is called with a valid request', function(done) {
      const proboscis = new Proboscis();
      config.port = port;

      const server = createServer(proboscis, config, function() {
        fetch('http://localhost:' + config.port + '/running-processes/beeper', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            command: 'foo',
            args: ['-c'],
          }),
        }).then(async function(response) {
          proboscis.commandWasRun['0'].should.equal('beeper');
          proboscis.commandWasRun['1'].should.equal('foo');
          proboscis.commandWasRun['2'].length.should.equal(1);
          proboscis.commandWasRun['2'][0].should.equal('-c');
          response.status.should.equal(200);
          server.close(done);
        });
      });
    });
  });

  describe('PUT', function() {

    it('should return a 404 if the command was not already created', function(done) {
      const proboscis = new Proboscis();
      config.port = port;
      const server = createServer(proboscis, config, function() {
        fetch('http://localhost:' + config.port + '/processes/no-good', {
          method: 'PUT',
        }).then(function(response) {
          response.status.should.equal(404);
          server.close(done);
        });
      });
    });

    it('should return a 201 if the command was able to start', function(done) {
      const proboscis = new Proboscis();
      config.port = port;
      let commandWasRun = null;
      const server = createServer(proboscis, config, function() {
        proboscis.runCommand = function() {
          commandWasRun = arguments;
        };
        fetch('http://localhost:' + config.port + '/processes/foo', {
          method: 'PUT',
        }).then(function(response) {
          response.status.should.equal(201);
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
        if (JSON.parse(message).message === 'Server successfully shutdown') {
          done();
        }
      };
      config.keepAlive = false;
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
        proboscis.emit('allProcessesClosed');
      });
    });

    it('should not kill the process when the last process exits if keepalive is on', function(done) {
      config.port = port;
      // We use a timeout to detect if the server would have closed by itself
      // before we kill it.
      let timedOut = false;
      config.log = function(message) {
        if (!timedOut && JSON.parse(message).message === 'Server successfully shutdown') {
          done(new Error('Server shut down'));
        }
      };
      config.keepAlive = true;
      const proboscis = new Proboscis();
      const server = createServer(proboscis, config, function() {
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
