'use strict';

const should = require('should');
const Proboscis = require('..');
const path = require('path');

const pathToBeeper = path.join(__dirname, 'fixtures', 'beeper.js');

describe('Proboscis', function() {
  describe('non-command running methods', function() {
    describe('getConfigs', function() {
      it('should return a single config by name', function() {
        const runner = new Proboscis();
        runner.addProcess('foo', 'echo', ['bar', 'baz']);
        runner.addProcess('bar', 'echo', ['bar', 'baz']);
        const output = runner.getConfig('foo');
        const expected = {
          name: 'foo',
          command: 'echo',
          args: ['bar', 'baz'],
          start: true,
        };
        JSON.stringify(output).should.equal(JSON.stringify(expected));
      });
      it('should return null if a bad config is specified', function() {
        const runner = new Proboscis();
        runner.addProcess('foo', ['bar', 'baz']);
        runner.addProcess('bar', ['bar', 'baz']);
        should.not.exist(runner.getConfig('zap'));
      });
      it('should return all configs if no name is specified', function() {
        const runner = new Proboscis();
        runner.addProcess('foo', 'echo', ['bar', 'baz']);
        runner.addProcess('bar', 'ping', ['bar', 'baz']);
        const output = runner.getConfig();
        Object.keys(output).length.should.equal(2);
        const expected = {
          name: 'foo',
          command: 'echo',
          args: ['bar', 'baz'],
          start: true,
        };
        JSON.stringify(output['foo']).should.equal(JSON.stringify(expected));
      });
    });
  });
});
