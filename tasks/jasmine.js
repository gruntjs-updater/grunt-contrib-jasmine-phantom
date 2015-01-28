/*
 * grunt-contrib-jasmine
 * http://gruntjs.com/
 *
 * Copyright (c) 2015 GruntJS Team
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // node api
  var fs   = require('fs'), path = require('path'), async = require('async'), os = require('os');

  var current = "";

  // npm lib
  var chalk = require('chalk'),
      _ = require('lodash');

  // local lib

  var junitTemplate = __dirname + '/jasmine/templates/JUnit.tmpl';

  var status = {};

  var symbols = {
    none : {
      check : '',
      error : '',
      splat : ''
    },
    short : {
      check : '.',
      error : 'X',
      splat : '*'
    },
    full : {
      check : '✓',
      error : 'X',
      splat : '*'
    }
  };

  //With node.js on Windows: use symbols available in terminal default fonts
  //https://github.com/visionmedia/mocha/pull/641
  if (process && process.platform === 'win32') {
    symbols = {
      none : {
        check : '',
        error : '',
        splat : ''
      },
      short : {
        check : '.',
        error : '\u00D7',
        splat : '*'
      },
      full : {
        check : '\u221A',
        error : '\u00D7',
        splat : '*'
      }
    };
  }

  grunt.registerMultiTask('jasmine', 'Run jasmine specs headlessly through PhantomJS.', function() {

    var providedSpecs;

    try {
      providedSpecs = this.args.filter(function (v) {
        return v.indexOf('run=') === 0;
      })[0].split('=')[1].split('|');
    } catch (e) {
      providedSpecs = "all";
    }
    // Merge task-specific options with these defaults.
    var options = this.options({
      version : '2.0.1',
      timeout : 10000,
      styles : [],
      specs : [],
      helpers : [],
      vendor : [],
      polyfills : [],
      outfile : '_SpecRunner.html',
      host : '',
      template : __dirname + '/jasmine/templates/DefaultRunner.tmpl',
      templateOptions : {},
      junit : {},
      ignoreEmpty: grunt.option('force') === true,
      display: 'full',
      summary: false,
    });

    if (grunt.option('debug')) {
        grunt.log.debug(options);
    }

    // setup(options);

    var phantomjs = require('grunt-lib-phantomjs').init(grunt);

    var jasmine = require('./lib/jasmine').init(grunt, phantomjs);

    // jasmine.cleanTemp();

    var builtSpecRunner = jasmine.buildSpecrunner(this.filesSrc, options, providedSpecs === "all" ) || [];

    // The filter returned no spec files so skip phantom.
    if (!builtSpecRunner[0]) {
        return;
        // return removePhantomListeners(phantomjs);
    }

    // If we're just building (e.g. for web), skip phantom.
    if (this.flags.build) {
      // removePhantomListeners(phantomjs);
      return;
    }

    var specNames = builtSpecRunner[1] || providedSpecs;

    var done = this.async();

    var canRun = 1, freeMem = Math.floor(os.freemem() / (1024 * 1024)) - 2000;

    canRun = Math.max(1, Math.floor(freeMem / 300));

    // console.log(canRun);

    var totalSpecs = 0, totalTime = 0, emptySpecs = [], failed = [];

    var specQueue = async.queue(function(task, callback) {

      var beforeInit = os.freemem();

      // console.log(task);

      var phantomjs = require('grunt-lib-phantomjs').init(grunt);

      var jasmine = require('./lib/jasmine').init(grunt, phantomjs);

      setup(options, phantomjs, jasmine, function(duration, specCount, failedSpecs, isEmpty) {
          totalSpecs += parseInt(specCount, 10);
          totalTime += duration;
          failed.push.apply(failed, failedSpecs);
          if(isEmpty) {
              emptySpecs[emptySpecs.length] = task;
          }
      }, task);

      // finished(dur, specQuantity, thisRun.summary.length, isFailed);

      current = task;

      options.outfile = '_SpecRunner.html?spec=' + task;

      // console.log(options.outfile);

      phantomRunner(options, function(err, status) {
          var success = !err && status.failed === 0;
          if (err) {
            // grunt.log.error(err);
          }
          if (status.failed === 0) {
            // grunt.log.ok('0 failures');
          } else {
            // grunt.log.error(status.failed + ' failures');
          }

          memoryUsage[memoryUsage.length] = [task, Math.ceil((beforeInit - os.freemem()) / (1024 * 1024))];

          teardown(options, callback, phantomjs, jasmine);

          // console.log(phantomjs);
          // callback();
        }, phantomjs);

    }, 1);

    grunt.verbose.writeln('Jasmine Runner Starting...');

    var startedTime = Date.now();

    var memoryUsage = [];

    async.each(specNames, function(spec, callback) {
        specQueue.push(spec, function() {
            callback();
            // console.log(spec + " is completed");
        });
    }, function() {
        if (!options.keepRunner && fs.statSync(options.outfile).isFile()) {
            fs.unlink(options.outfile);
        }
        if (!options.keepRunner) {
          jasmine.cleanTemp();
        }
        grunt.verbose.writeln('Jasmine Runner Finished...');
        console.log(chalk.green('\n________________________________REPORT START_____________________________\n'));
        console.log(chalk.yellow('Total time for running specs ') + ' : ' + chalk.green((Date.now() - startedTime) + 'ms.') +  '\n');
        console.log(chalk.yellow('Total number of specs') + ' : ' + chalk.green(totalSpecs) + '\n');
        if(emptySpecs.length > 0) {
            console.log(chalk.bgRed.white.bold('Specs not qualified for testing : ' + emptySpecs.join(',')) + '\n');
        }

        console.log(chalk[failed.length > 0 ? 'red' : 'blue']('Number of failed specs : ' + failed.length) + '\n');

        for(var i = 0; i < failed.length; i++) {
            console.log(chalk.red(failed[i].name + '\n'));
        }

        for(i = 0; i < memoryUsage.length; i++) {
            if(memoryUsage[i][1] > 300) {
                console.log(chalk.red(memoryUsage[i][0] + ' consumed more than 300MB(' + memoryUsage[i][1] + 'MB). Please split it. \n'));
            }
        }

        if(failed.length > 0) {
          grunt.log.error('Few specs failed.');
        }

        console.log(chalk.green('\n________________________________REPORT END_______________________________\n'));
        done(true);
    });

  });

  function phantomRunner(options, cb, phantomjs) {
    var file = options.outfile;

    if (options.host) {
      if (!(/\/$/).test(options.host)) options.host = options.host + '/';
      file = options.host + options.outfile;
    }

    // grunt.verbose.subhead('Testing jasmine specs via phantom').or.writeln('Testing jasmine specs via PhantomJS');
    grunt.log.writeln('');

    phantomjs.spawn(file, {
      failCode : 90,
      options : options,
      done : function(err){
        cb(err,status);
      }
    });
  }

  function teardown(options, cb, phantomjs, jasmine) {
    removePhantomListeners(phantomjs);
    cb();
    // jasmine.cleanTemp();
  }

  function removePhantomListeners(phantomjs) {
    phantomjs.removeAllListeners();
    phantomjs.listenersAny().length = 0;
  }

  function setup(options, phantomjs, jasmine, finished, current) {
    var indentLevel = 1,
        tabstop = 2,
        thisRun = {},
        suites = {},
        currentSuite,
        optionalHandlers,
        eventName,
        handler;

    status = {
      failed   : 0
    };

    function indent(times) {
      return new Array(+times * tabstop).join(' ');
    }

    phantomjs.on('fail.load', function() {
      grunt.log.writeln();
      grunt.warn('PhantomJS failed to load your page.', 90);
    });

    phantomjs.on('fail.timeout', function() {
      grunt.log.writeln();
      grunt.warn('PhantomJS timed out, possibly due to an unfinished async spec.', 90);
    });

    phantomjs.on('console', function(msg) {
      thisRun.cleanConsole = false;
      if(options.display === 'full') {
        grunt.log.writeln('\n' + chalk.yellow('log: ') + msg);
      }
    });

    phantomjs.on('error.onError', function(string, trace){
      if (trace && trace.length) {
        // grunt.log.error(chalk.red(string) + ' at ');
        trace.forEach(function(line) {
          var file = line.file.replace(/^file:/,'');
          var message = grunt.util._('%s:%d %s').sprintf(path.relative('.',file), line.line, line.function);
          // grunt.log.error(chalk.red(message));
        });
      } else {
        // grunt.log.error("Error caught from PhantomJS. More info can be found by opening the Spec Runner in a browser.");
        // grunt.warn(string);
      }
    });

    phantomjs.onAny(function() {
      var args = [this.event].concat(grunt.util.toArray(arguments));
      grunt.event.emit.apply(grunt.event, args);
    });

    phantomjs.on('jasmine.jasmineStarted', function() {
      // grunt.verbose.writeln('Jasmine Runner Starting...');
      thisRun.startTime = (new Date()).getTime();
      thisRun.executedSpecs = 0;
      thisRun.passedSpecs = 0;
      thisRun.failedSpecs = 0;
      thisRun.skippedSpecs = 0;
      thisRun.summary = [];
    });

    phantomjs.on('jasmine.suiteStarted', function(suiteMetaData) {

      if(suiteMetaData.fullName.indexOf(current) !== 0) {
          return;
      }

      currentSuite = suiteMetaData.id;
      suites[currentSuite] = {
        name : suiteMetaData.fullName,
        timestamp : new Date(suiteMetaData.startTime),
        errors : 0,
        tests : 0,
        failures : 0,
        testcases : []
      };
      if(options.display === 'full') {
        grunt.log.write(indent(indentLevel++));
        grunt.log.writeln(chalk.bold(suiteMetaData.description));
      }
    });

    phantomjs.on('jasmine.suiteDone', function(suiteMetaData) {

      if(suiteMetaData.fullName.indexOf(current) !== 0) {
        return;
      }

      suites[suiteMetaData.id].time = suiteMetaData.duration / 1000;
      if(indentLevel > 1) {
        indentLevel--;
      }
    });

    phantomjs.on('jasmine.specStarted', function(specMetaData) {

      if(specMetaData.fullName.indexOf(current) !== 0) {
        return;
      }

      thisRun.executedSpecs++;
      thisRun.cleanConsole = true;
      if(options.display === 'full') {
        grunt.log.write(indent(indentLevel) + '- ' + chalk.grey(specMetaData.description) + '...');
      } else if(options.display === 'short' ) {
        grunt.log.write(chalk.grey('.'));
      }
    });

    phantomjs.on('jasmine.specDone', function(specMetaData) {

      // console.log(specMetaData);
      if(specMetaData.fullName.indexOf(current) !== 0) {
        return;
      }

      var specSummary = {
        assertions : 0,
        classname : suites[currentSuite].name,
        name : specMetaData.description,
        time : specMetaData.duration / 1000,
        failureMessages : []
      };

      suites[currentSuite].tests++;

      var color = 'yellow',
          symbol = 'splat';
      if (specMetaData.status === "passed") {
        thisRun.passedSpecs++;
        color = 'green';
        symbol = 'check';
      } else if (specMetaData.status === "failed") {
        thisRun.failedSpecs++;
        status.failed++;
        color = 'red';
        symbol = 'error';
        suites[currentSuite].failures++;
        suites[currentSuite].errors += specMetaData.failedExpectations.length;
        specSummary.failureMessages = specMetaData.failedExpectations.map(function(error){
          return error.message;
        });
        thisRun.summary.push({
          suite: suites[currentSuite].name,
          name: specMetaData.description,
          errors: specMetaData.failedExpectations.map(function(error){
            return {
              message: error.message,
              stack: error.stack
            };
          })
        });
      } else {
        thisRun.skippedSpecs++;
      }

      suites[currentSuite].testcases.push(specSummary);

      // If we're writing to a proper terminal, make it fancy.

      // console.log(specMetaData.status);

      if (process.stdout.clearLine && specMetaData.status != "disabled") {
        if(options.display === 'full') {
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          grunt.log.writeln(
              indent(indentLevel) +
              chalk[color].bold(symbols.full[symbol]) + ' ' +
              chalk.grey(specMetaData.description)
          );
        } else if(options.display === 'short') {
          process.stdout.moveCursor(-1);
          grunt.log.write(chalk[color].bold(symbols.short[symbol]));
        }
      } else {
        // If we haven't written out since we've started
        if (thisRun.cleanConsole) {
          // then append to the current line.
          if (options.display !== 'none') {
            grunt.log.writeln('...' + symbols[options.display][symbol]);
          }
        } else {
          // Otherwise reprint the current spec and status.
          if (options.display !== 'none') {
            grunt.log.writeln(
                indent(indentLevel) + '...' +
                chalk.grey(specMetaData.description) + '...' +
                symbols[options.display][symbol]
            );
          }
        }
      }

      specMetaData.failedExpectations.forEach(function(error, i){
        var specIndex = ' ('+(i+1)+')';
        if(options.display === 'full') {
          grunt.log.writeln(indent(indentLevel + 1) + chalk.red(error.message + specIndex));
        }
        phantomjs.emit('onError', error.message, error.stack);
      });

    });

    phantomjs.on('jasmine.jasmineDone', function(){
      var dur = (new Date()).getTime() - thisRun.startTime;
      var specQuantity = thisRun.executedSpecs + (thisRun.executedSpecs === 1 ? " spec " : " specs ");
      var isFailed = false;
      var failedCount = 0;

      // grunt.verbose.writeln('Jasmine runner finished');

      if (thisRun.executedSpecs === 0) {
        // log.error will print the message but not fail the task, warn will do both.
        var log = (options.ignoreEmpty) ? grunt.log.error : grunt.warn;
        isFailed = true;
        // log('No specs executed, is there a configuration error?');
      }

      if(options.display === 'short') {
        grunt.log.writeln();
      }

      if(options.summary && thisRun.summary.length) {
        grunt.log.writeln();
        // logSummary(thisRun.summary);
        // failedCount += thisRun.summary
      }

      if (options.junit && options.junit.path) {
        writeJunitXml(suites);
      }

      // grunt.log.writeln('\n' + specQuantity + 'in ' + (dur / 1000) + "s.");

      finished(dur, specQuantity, thisRun.summary, isFailed);
    });

    function logSummary(tests) {
      grunt.log.writeln('Summary (' + tests.length + ' tests failed)');
      _.forEach(tests, function(test){
        grunt.log.writeln(chalk.red(symbols[options.display]['error']) + ' ' + test.suite + ' ' + test.name);
        _.forEach(test.errors, function(error){
          grunt.log.writeln(indent(2) + chalk.red(error.message));
          logStack(error.stack, 2);
        });
      });
    }

    function logStack(stack, indentLevel) {
      var lines = (stack || '').split('\n');
      for (var i = 0; i < lines.length && i < 11; i++) {
        grunt.log.writeln((indent(indentLevel) + lines[i]));
      }
    }

    function writeJunitXml(testsuites){
      var template = grunt.file.read(options.junit.template || junitTemplate);
      if (options.junit.consolidate) {
        var xmlFile = path.join(options.junit.path, 'TEST-' + testsuites.suite1.name.replace(/[^\w]/g, '') + '.xml');
        grunt.file.write(xmlFile, grunt.util._.template(template, { testsuites: _.values(testsuites)}));
      } else {
        _.forEach(testsuites, function(suiteData){
          var xmlFile = path.join(options.junit.path, 'TEST-' + suiteData.name.replace(/[^\w]/g, '') + '.xml');
          grunt.file.write(xmlFile, _.template(template, { testsuites: [suiteData] }));
        });
      }
    }

    phantomjs.on('jasmine.done', function(elapsed) {
        phantomjs.halt();
    });

    phantomjs.on('jasmine.done.PhantomReporter', function() {
        phantomjs.emit('jasmine.done');
    });

    phantomjs.on('jasmine.done_fail', function(url) {
      grunt.log.error();
      grunt.warn('PhantomJS unable to load "' + url + '" URI.', 90);
    });

    optionalHandlers = options.handlers || {};
    for(eventName in optionalHandlers) {
      handler = optionalHandlers[eventName];
      phantomjs.on(eventName, typeof handler === "function" ? handler: function(){});
    }
  }

};
