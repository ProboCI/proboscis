'use strict';

module.exports = function(data) {
  if (!data.hasOwnProperty('command') || typeof data.command !== 'string') {
    return false;
  }
  if (data.hasOwnProperty('args') && !(data.args instanceof Array)) {
    return false;
  }
  if (data.hasOwnProperty('options') && data.options instanceof Array) {
    return false;
  }
  if (data.hasOwnProperty('options') && typeof data.options !== 'object') {
    return false;
  }
  const keys = Object.keys(data);
  for (const i in keys) {
    if (['command', 'args', 'options'].indexOf(keys[i]) === -1) {
      return false;
    }
  }
  return true;
};
