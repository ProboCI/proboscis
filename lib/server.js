'use strict';

const pack = require('../package');
const util = require('util');
const http = require('http');
const through2 = require('through2');

/**
 * Read and JSON parse a request body.
 *
 * @param {http.IncomingMessage} req The request to read.
 * @param {Function} done Callback receiving the parsed body, or null if the
 *     body was empty or could not be parsed.
 */
function readJSONBody(req, done) {
  const chunks = [];
  req.on('data', function(chunk) {
    chunks.push(chunk);
  });
  req.on('end', function() {
    if (chunks.length === 0) {
      return done(null);
    }
    try {
      done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }
    catch (e) {
      done(null);
    }
  });
  req.on('error', function() {
    done(null);
  });
}

/**
 * Send a JSON response.
 *
 * @param {http.ServerResponse} res The response to write to.
 * @param {number} status The HTTP status code.
 * @param {Object} body The object to serialize as the response body.
 */
function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

module.exports = function(proboscis, config, done) {

  /* istanbul ignore next */
  const log = config.log || console.log;

  // Sockets held open by streaming `/log` responses. These never end on their
  // own, so we track them and tear them down when the server closes.
  const logSockets = new Set();

  const server = http.createServer(function(req, res) {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const method = req.method;

    // Normalize away any trailing slashes so `/log` and `/log/` both route.
    let path = url.pathname;
    while (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    if (method === 'GET' && path === '/') {
      return sendJSON(res, 200, {
        name: pack.name,
        version: pack.version,
      });
    }

    if (method === 'GET' && path === '/log') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      logSockets.add(res.socket);
      res.on('close', function() {
        logSockets.delete(res.socket);
      });
      proboscis.eventStream
        .pipe(through2.obj(function(data, enc, cb) {
          this.push(JSON.stringify(data));
          cb();
        }))
        .pipe(res);
      return;
    }

    if (method === 'GET' && path === '/running-processes') {
      const output = {};
      const configs = proboscis.getConfig();
      for (const name in proboscis.getChildren()) {
        output[name] = configs[name];
      }
      return sendJSON(res, 200, output);
    }

    const runningProcess = /^\/running-processes\/([^/]+)$/.exec(path);

    if (runningProcess && method === 'DELETE') {
      const name = decodeURIComponent(runningProcess[1]);
      const children = proboscis.getChildren();
      if (!children[name]) {
        res.writeHead(404);
        return res.end();
      }
      let timeout = null;
      const closeListener = function() {
        clearTimeout(timeout);
        sendJSON(res, 200, {message: util.format('Process `%s` stopped', name)});
      };
      timeout = setTimeout(function() {
        proboscis.removeListener('processClosed:' + name, closeListener);
        sendJSON(res, 500, {message: 'Process failed to close.'});
      }, server.killProcessTimeout);
      proboscis.once('processClosed:' + name, closeListener);
      children[name].kill();
      return;
    }

    if (runningProcess && method === 'POST') {
      const name = decodeURIComponent(runningProcess[1]);
      return readJSONBody(req, function(body) {
        if (!body || !body.command) {
          res.writeHead(400);
          return res.end();
        }
        proboscis.runCommand(name, body.command, body.args || []);
        sendJSON(res, 200, {message: util.format('Process `%s` started', name)});
      });
    }

    const process_ = /^\/processes\/([^/]+)$/.exec(path);

    if (process_ && method === 'PUT') {
      const name = decodeURIComponent(process_[1]);
      const processConfig = proboscis.getConfig(name);
      if (processConfig) {
        proboscis.runCommand(processConfig.name, processConfig.command, processConfig.args);
        return sendJSON(res, 201, {message: util.format('Process `%s` started', name)});
      }
      res.writeHead(404);
      return res.end();
    }

    res.writeHead(404);
    res.end();
  });

  server.name = pack.name;
  server.killProcessTimeout = 3000;

  // `/log` streams never end on their own and idle keep-alive sockets linger,
  // either of which would stall `close()` and keep the process alive. Tear
  // both down, leaving in-flight non-streaming responses to flush normally.
  const close = server.close.bind(server);
  server.close = function(callback) {
    for (const socket of logSockets) {
      socket.destroy();
    }
    logSockets.clear();
    const result = close(callback);
    // Deferred a tick so a response that just called `end()` gets flushed to
    // the socket before any idle keep-alive connection is torn down.
    setImmediate(function() {
      server.closeIdleConnections();
    });
    return result;
  };

  server.listen(config.port, function() {
    const address = server.address();
    server.url = 'http://' + (address.family === 'IPv6' ? '[' + address.address + ']' : address.address) + ':' + address.port;
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
