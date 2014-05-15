var gulp = require('gulp');
var mocha = require('gulp-mocha');
var jshint = require('gulp-jshint');
var es = require('event-stream');

var paths = {
  tests: ['test/test*.js'],
  src: ['index.js'],
};

gulp.task('test', function() {
  try {
    gulp.src(paths.tests)
      .pipe(mocha({reporter: 'spec'}));
  }
  catch (e) {
    console.error('Mocha tests failed');
  }
});

gulp.task('jshint', function() {
  var through = es.through();
  gulp.src(paths.src)
    .pipe(jshint.reporter('default'));
});

gulp.task('watch', function() {
  gulp.watch(paths.tests, ['jshint', 'test']);
  gulp.watch(paths.src, ['jshint', 'test']);
});

gulp.task('default', ['test']);


