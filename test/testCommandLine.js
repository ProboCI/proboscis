'use strict';

const path = require('path');
const should = require('should');
const run = require('comandante');
const es = require('event-stream');
const async = require('async');

const filter = require('./helpers/filter');

const beeperPath = path.join(__dirname, 'fixtures', 'beeper.js');
const proboscisBinPath = path.join(__dirname, '..', 'bin', 'proboscis');

describe('proboscis executable', function() {
  this.timeout(5000);
  it('should display helptext', function(done) {
    const stream = run(proboscisBinPath, ['-h']);
    let output = '';
    const collect = function(data) {
      output += data;
    };
    const check = function() {
      output.should.containEql('Display this help text');
      done();
    };
    stream.on('data', collect);
    stream.stderr.on('data', collect);
    stream.on('end', check);
  });
  it('should print its own version number', function(done) {
    const stream = run(proboscisBinPath, ['-v']);
    stream
      .pipe(es.split())
      .pipe(es.writeArray(function(error, array) {
        should.exist(array[0]);
        array[0].should.equal(require('../package').version);
        done(error);
      }));
  });
  it('should run a single command', function(done) {
    const args = [
      '-c', beeperPath,
    ];
    const stream = run(proboscisBinPath, args);
    stream
      .pipe(es.split())
      .pipe(es.parse())
      .pipe(es.writeArray(function(error, array) {
        array.length.should.equal(2);
        array[0].stream.should.equal('stdout');
        array[0].message.should.equal('beep');
        array[1].stream.should.equal('stderr');
        array[1].message.should.equal('boop');
        done(error);
      }));
  });
  it('should run a multiple commands', function(done) {
    const args = [
      '-c', 'echo foo',
      '-c', beeperPath + ' -S jimmy -E hendrix',
    ];
    const stream = run(proboscisBinPath, args);

    const eventStream = es.through();

    stream
      .pipe(es.split())
      .pipe(es.parse())
      .pipe(eventStream);
    async.parallel(
      [
        function(cb) {
          eventStream
            .pipe(filter({name: 'echo'}))
            .pipe(es.writeArray(function(error, array) {
              array.length.should.equal(1);
              array[0].message.should.equal('foo');
              cb(error);
            }));
        },
        function(cb) {
          eventStream
            .pipe(filter({name: beeperPath, stream: 'stdout'}))
            .pipe(es.writeArray(function(error, array) {
              array.length.should.equal(1);
              array[0].message.should.equal('jimmy');
              cb(error);
            }));
        },
        function(cb) {
          eventStream
            .pipe(filter({name: beeperPath, stream: 'stderr'}))
            .pipe(es.writeArray(function(error, array) {
              array.length.should.equal(1);
              array[0].message.should.equal('hendrix');
              cb(error);
            }));
        },
      ],
    function(error) {
      done();
    });
  });
});
