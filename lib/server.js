'use strict';

const pack = require('../package');
const util = require('util');
const restify = require('restify');
const through2 = require('through2');

module.exports = function(proboscis, config, done) {

  /* istanbul ignore next */
  const log = config.log || console.log;

  const server = restify.createServer({
    name: pack.name,
    version: pack.version,
  });
  server.use(restify.plugins.acceptParser(server.acceptable));
  server.use(restify.plugins.queryParser());
  server.use(restify.plugins.bodyParser());
  server.killProcessTimeout = 3000;

  server.get('/', function(req, res, next) {
    res.send({
      name: pack.name,
      version: pack.version,
    });
    return next();
  });

  server.get('/log', function(req, res, next) {
    res.writeHead(200);
    proboscis.eventStream
      .pipe(through2.obj(function(data, enc, cb) {
        this.push(JSON.stringify(data));
        cb();
      }))
      .pipe(res);
  });

  server.get('/running-processes', function(req, res, next) {
    const output = {};
    const configs = proboscis.getConfig();
    for (const name in proboscis.getChildren()) {
      output[name] = configs[name];
    }
    res.send(output);
    return next();
  });

  server.del('/running-processes/:name', function(req, res, next) {
    const children = proboscis.getChildren();
    const name = req.params.name;
    if (!children[name]) {
      res.writeHead(404);
      return res.end();
    }
    let timeout = null;
    const closeListener = function() {
      res.send({message: util.format('Process `%s` stopped', name)});
      clearTimeout(timeout);
    };
    timeout = setTimeout(function() {
      proboscis.removeListener('processClosed:' + name, closeListener);
      res.writeHead(500);
      res.end(JSON.stringify({message: 'Process failed to close.'}));
    }, server.killProcessTimeout);
    proboscis.once('processClosed:' + name, closeListener);
    children[name].kill();
  });

  server.post('/running-processes/:name', function(req, res, next) {
    if (!req.body || !req.body.command) {
      res.writeHead(400);
      res.end();
      next();
      return;
    }
    const args = req.body.args || [];
    proboscis.runCommand(req.params.name, req.body.command, args);
    res.send({message: util.format('Process `%s` started', req.params.name)});
  });

  server.put('/processes/:name', function(req, res, next) {
    const name = req.params.name;
    let config = null;
    if (config = proboscis.getConfig(name)) {
      proboscis.runCommand(config.name, config.command, config.args);
      res.writeHead(201);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(config.port, function() {
    const message = {
      message: util.format('%s listening at %s', server.name, server.url),
    };
    log(JSON.stringify(message));
    if (done) {
      done();
    }
  });

  server.on('close', function() {
    const message = {message: 'Server successfully shutdown'};
    log(JSON.stringify(message));
  });

  if (!config.keepAlive) {
    proboscis.on('allProcessesClosed', function() {
      const message = {message: 'All processes closed, server stopping'};
      log(JSON.stringify(message));
      server.close(function() {
        const message = {message: 'Server exiting gracefully.'};
        log(JSON.stringify(message));
      });
    });
  }

  return server;
};
