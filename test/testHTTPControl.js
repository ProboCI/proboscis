var should = require('should'),
  request = require('request'),
  portfinder = require('portfinder'),
  async = require('async'),
  util = require('util'),
  EventEmitter = require('events').EventEmitter,
  createServer = require('../lib/server');

var Penelope = function() {
  this.name = 'penelope';
  this.version = '1.0.0';
  this.configs = {
    'foo': {
      name: "test/fixtures/beeper.js",
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

util.inherits(Penelope, EventEmitter);

Penelope.prototype.setChild = function(name, child) {
  this.children[name] = child;
};
Penelope.prototype.getConfig = function(name) {
  return this.configs;
};

Penelope.prototype.getChildren = function() {
  return this.children;
};

var config = {
  keepAlive: true,
  log: function() {}
};
var ports = {};

describe('HTTP server', function() {
  before(function(done) {
    async.parallel([
      portfinder.getPort,
      portfinder.getPort,
      portfinder.getPort
    ], function(error, results) {
      ports['version'] = results[0];
      ports['running'] = results[1];
      ports['delete'] = results[2];
      done();
    });
  });
  it('should report the version number', function(done) {
    config.port = ports['version'];
    var server = createServer(new Penelope, config, function() {
      request('http://localhost:' + ports['version'], function (error, response, body) {
        body = JSON.parse(body);
        body.name.should.equal('lepew-penelope');
        body.version.should.equal('0.0.3');
        server.close(function() {
          done();
        });
      });
    });
  });
  it('should list the running processes', function(done) {
    config.port = ports['running'];
    var server = createServer(new Penelope, config, function() {
      request('http://localhost:' + ports['running'] + '/running-processes', function (error, response, body) {
        body = JSON.parse(body);
        Object.keys(body).length.should.equal(1);
        body.foo.args.length.should.equal(3);
        server.close(function() {
          done();
        });
      });
    });
  });
  it('should kill a process when a delete method is called', function(done) {
    config.port = ports['delete'];
    var penelope = new Penelope();
    var server = createServer(penelope, config, function() {
      penelope.setChild('scratchy', {
        kill: function() {
          server.close(function() {
            done();
          });
        }
      });
      request.del('http://localhost:' + ports['delete'] + '/running-processes/scratchy', function (error, response, body) {
        JSON.parse(body).message.should.equal('Kill message sent');
      });
    });
  });
});


