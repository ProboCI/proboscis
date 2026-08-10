'use strict';

const util = require('util');
const path = require('path');
const fs = require('fs');

module.exports = function(files, done) {
  if (files.length > 0) {
    // Map resolve the paths
    files = files.map(function(localPath) {
      return path.resolve(path.join(process.cwd(), localPath));
    });

    const readFile = function(filePath, cb) {
      fs.readFile(filePath, 'utf8', function(error, data) {
        if (error) {
          return cb(error);
        }
        try {
          const config = JSON.parse(data);
          cb(null, {filePath: filePath, config: config});
        }
        catch (e) {
          error = new Error(util.format('Parsing file `%s` failed.', filePath));
          error.code = 'PARSE';
          error.path = filePath;
          cb(error);
        }
      });
    };

    const async = require('async');
    async.map(files, readFile, done);
  }
  else {
    done(null, []);
  }
};
