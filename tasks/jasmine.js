/*
 * grunt-contrib-jasmine
 * http://gruntjs.com/
 *
 * Copyright (c) 2015 GruntJS Team
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {

    var exec = require('child_process').exec;

    exec('killall -9 phantomjs', function (error, stdout, stderr) {
        // console.log(arguments);
    });

    var uuid = require('node-uuid');

    function msToTime(duration) {
        var milliseconds = parseInt((duration % 1000) / 100),
            seconds = parseInt((duration / 1000) % 60),
            minutes = parseInt((duration / (1000 * 60)) % 60),
            hours = parseInt((duration / (1000 * 60 * 60)) % 24);

        hours = (hours < 10) ? "0" + hours : hours;
        minutes = (minutes < 10) ? "0" + minutes : minutes;
        seconds = (seconds < 10) ? "0" + seconds : seconds;

        return hours + ":" + minutes + ":" + seconds + "." + milliseconds;
    }

    // node api
    var fs = require('fs'),
        path = require('path'),
        async = require('async'),
        os = require('os');

    var current = "";

    /*var WebSocket = require('ws') , ws = new WebSocket('ws://localhost:3000');

     ws.on('open', function() {
     ws.send('Connected');
     });*/

    // npm lib
    var chalk = require('chalk'),
        _ = require('lodash');

    // local lib

    var junitTemplate = __dirname + '/jasmine/templates/JUnit.tmpl';

    var status = {};

    var symbols = {
        none: {
            check: '',
            error: '',
            splat: ''
        },
        short: {
            check: '.',
            error: 'X',
            splat: '*'
        },
        full: {
            check: '✓',
            error: 'X',
            splat: '*'
        }
    };

    require('console.table');

    function shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
        return array;
    }

    //With node.js on Windows: use symbols available in terminal default fonts
    //https://github.com/visionmedia/mocha/pull/641
    if (process && process.platform === 'win32') {
        symbols = {
            none: {
                check: '',
                error: '',
                splat: ''
            },
            short: {
                check: '.',
                error: '\u00D7',
                splat: '*'
            },
            full: {
                check: '\u221A',
                error: '\u00D7',
                splat: '*'
            }
        };
    }

    try {
        fs.mkdirSync('./lcov');
    } catch (e) {

    }

    var reportQueue = [];
    /*async.queue(function(task, cb) {
     var id = 'locv_' + task.file;
     fs.writeFileSync('./lcov/' + id + '.info', task.data, 'utf8', function(err){
     if(err) {
     console.log('Error storing report for ' + task.file);
     }
     cb();
     });
     }, 10)*/
    ;

    var $phantomjs = require('grunt-lib-phantomjs');

    var $jasmine = require('./lib/jasmine');

    grunt.registerMultiTask('jasmine', 'Run jasmine specs headlessly through PhantomJS.', function () {
        var done = this.async();

        var cover = grunt.option('coverage');

        var LZString = require('../vendor/lz-string.js');

        var providedSpecs, optionalHandlers, eventName, handler;

        try {
            providedSpecs = this.args.filter(function (v) {
                return v.indexOf('run=') === 0;
            })[0].split('=')[1].split('|');
        } catch (e) {
            providedSpecs = "all";
        }

        // Merge task-specific options with these defaults.
        var options = this.options({
            version: '2.0.1',
            timeout: 600000,
            styles: [],
            specs: [],
            helpers: [],
            vendor: [],
            polyfills: [],
            outfile: '_SpecRunner.html',
            host: '',
            template: __dirname + '/jasmine/templates/DefaultRunner.tmpl',
            templateOptions: {},
            junit: {},
            ignoreEmpty: grunt.option('force') === true,
            display: 'full',
            summary: false,
            cover: false,
            '--load-images': false
        });

        options.cover = cover;

        var guid;
        var t = options.uniqueId || "-";

        if(!t.split('-')[0]) {
            guid = 'xxxxxxxx_xxxx_4xxx_yxxx_xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {var r = Math.random()*16|0,v=c=='x'?r:r&0x3|0x8;return v.toString(16);});
        } else {
            guid = options.uniqueId;
        }
        
        if (grunt.option('debug')) {
            grunt.log.debug(options);
        }

        var phantomjs = $phantomjs.init(grunt);

        var jasmine = $jasmine.init(grunt, phantomjs);

        var builtSpecRunner = jasmine.buildSpecrunner(this.filesSrc, options, providedSpecs === "all") || [];

        // console.log('\nTime taken to build spec runner :' + msToTime(Date.now() - startedTime) + '\n');

        // The filter returned no spec files so skip phantom.
        if (!builtSpecRunner[0]) {
            return;
        }

        // If we're just building (e.g. for web), skip phantom.
        if (this.flags.build) {
            return;
        }

        var specNames = builtSpecRunner[1] || providedSpecs;

        var chunk_size = Math.ceil(specNames.length / os.cpus().length);

        var groups = specNames.map(function (e, i) {
            return i % chunk_size === 0 ? specNames.slice(i, i + chunk_size) : null;
        }).filter(function (e) {
            return e;
        });

        var specsLeft = specNames.slice(0);

        var outFileName = options.outfile.replace('.html', (options.cover && options.coverage ? '_phantom' : '') + '.html');

        var totalSpecs = 0,
            totalTime = 0,
            emptySpecs = [],
            failed = [],
            completed = 0;

        var pidQueue = {};

        var processes = {};

        var all_report = [],
            executables = [];

        var currentProgress = 0;

        var failedSpecs = [];

        var _table = [];

        var table = [];

        var consoleReport = function (task) {
            // console.log(task);
            console.log('\n' + chalk.underline.bold(task.file) + '( ' + chalk.yellow(task.duration) + 'ms )');
            var intFailed = 0,
                _totalSpecs = 0;
            var data = task.data;
            var indentLevel = 0;
            var traverse = function (_obj) {
                (function (obj) {
                    if (Object.keys(obj.specs).length === 0 && Object.keys(obj.suites).length === 0) {
                        console.log((new Array(indentLevel + 1).join(' ')) + chalk.red('No specs for this suite!'));
                    } else {
                        var specs = obj.specs;
                        for (var i in specs) {
                            totalSpecs += 1;
                            _totalSpecs += 1;
                            var item = specs[i],
                                msg = item.description,
                                msgC, pipeC, time = chalk.yellow;
                            switch (item.status) {
                                case "passed":
                                    msgC = chalk.italic.green;
                                    pipeC = chalk.cyan;
                                    break;
                                case "failed":
                                    intFailed += 1;
                                    msgC = chalk.italic.red;
                                    pipeC = chalk.red;
                                    failedSpecs[failedSpecs.length] = item;
                                    break;
                                default:
                                    msgC = chalk.bgYellow.black;
                                    pipeC = chalk.red;
                                    break;
                            }
                            console.log((new Array(indentLevel + 1).join(' ')) + pipeC('| ') + time('( ' + item.duration + 'ms' + ' ) ') + msgC(item.description));
                        }
                        var suites = obj.suites;
                        for (var i in suites) {
                            var item = suites[i],
                                time = chalk.yellow;
                            var msg = (new Array(indentLevel + 1).join(' ')) + chalk.gray.underline(i) + ' ( ' + time(item.duration + 'ms') + ' ) ';
                            console.log(msg);
                            indentLevel += 2;
                            traverse(item);
                            indentLevel -= 2;
                        }
                    }
                })(_obj);
            };
            indentLevel += 2;
            traverse(data);

            table.push({
                'Spec name': task.file,
                'Time': msToTime(task.duration),
                'Failed': intFailed,
                'Total Specs': _totalSpecs
            });
        };
        
        var coverageReport = {};

        function enque(callback) {

            function phantomRunner(options, cb, phantomjs) {

                var file = options.outfile;

                if (options.host) {
                    if (!(/\/$/).test(options.host)) options.host = options.host + '/';
                    file = options.host + options.outfile;
                }
                
                file += (file.indexOf('?') > -1 ? "&" : '?') + ("pid=" + guid);

                phantomjs.spawn(file, {
                    failCode: 90,
                    options: options,
                    done: function (err) {
                        cb(err, status);
                    }
                });

            }

            var task = this.task,
                thisReport = [];

            var phantomjs = $phantomjs.init(grunt),
                pid, memory;

            var jasmine = $jasmine.init(grunt, phantomjs);

            var clone = task.slice(0);

            var first = clone.splice(0, 1);

            options.outfile = outFileName + '?_spec=' + clone.join('|') + '\&spec=' + first;

            phantomjs.on('jasmine.jasmineDone', function () {
                // console.log(chalk.red('Jasmine done from one of the instances'));
                callback(null, thisReport);
                setTimeout(phantomjs.halt, 5000);
                // console.log(specsLeft);
            });

            phantomjs.on('jasmine.completedFile', function (report) {
                // console.log(report.file + ' is completed');
                var idx = specsLeft.indexOf(report.file);
                completed += 1;
                specsLeft.splice(idx, 1);
                var cP = Math.floor(((specNames.length - specsLeft.length) / specNames.length) * 100);
                for (var i = 0; i < cP - currentProgress; i++) {
                    // bar.tick();
                }
                currentProgress = cP;
                thisReport[thisReport.length] = report;
                consoleReport(report);
                // all_report[report.file] = report.data;
                // timings[report.file] = report.timings;
            });

            phantomjs.on('fail.load', function () {
                grunt.log.writeln();
                grunt.warn('PhantomJS failed to load your page.', 90);
            });

            phantomjs.on('fail.timeout', function () {
                grunt.log.writeln();
                grunt.warn('PhantomJS timed out, possibly due to an unfinished async spec.', 90);
            });

            phantomjs.on('console', function (msg) {
                if (options.debug) {// if (msg.indexOf('XMLHttpRequest') === -1) {
                    grunt.log.writeln('\n' + chalk.yellow('console : ') + chalk.italic(msg));
                }
            });

            phantomjs.on('logIt:start', function (data) {
                var pid = pidQueue[data.file];
                // console.log(data);
            });

            phantomjs.on('logIt:end', function (data) {
                // console.log(data);
            });

            phantomjs.on('error.onError', function (string, trace) {
                if (trace && trace.length) {
                    // grunt.log.error(chalk.red(string) + ' at ');
                    trace.forEach(function (line) {
                        var file = line.file.replace(/^file:/, '');
                        var message = grunt.util._('%s:%d %s').sprintf(path.relative('.', file), line.line, line.function);
                        // grunt.log.error(chalk.red(message));
                    });
                } else {
                    grunt.log.error("Error caught from PhantomJS. More info can be found by opening the Spec Runner in a browser.");
                    grunt.warn(string);
                }
            });

            phantomjs.onAny(function () {
                var args = [this.event].concat(grunt.util.toArray(arguments));
                grunt.event.emit.apply(grunt.event, args);
            });

            phantomjs.on('lcov', function (_report) {
                if (_report.data) {
                    coverageReport[_report.file] = _report.data;
                } else {
                    console.log(chalk.red(_report.file + ' file missed to report.'));
                }
                _report = null;
            });

            optionalHandlers = options.handlers || {};

            for(eventName in optionalHandlers) {
                handler = optionalHandlers[eventName];
                phantomjs.on(eventName, typeof handler === "function" ? handler: function(){});
            }

            pid = phantomRunner(options, function (err, status) {
                var success = !err && status.failed === 0;
                if (err) {
                    grunt.log.error(err);
                }
                if (status.failed === 0) {
                    // grunt.log.ok('0 failures');
                } else {
                    // grunt.log.error(status.failed + ' failures');
                }
            }, phantomjs);

            for (var i = 0; i < task.length; i++) {
                pidQueue[task[i]] = pid;
            }

        }

        for (var i = 0; i < groups.length; i++) {
            executables.push(enque.bind({
                task: groups[i]
            }));
        }

        grunt.verbose.writeln('Jasmine Runner Starting...');

        var startedTime = Date.now();

        var exec = require('child_process').exec;

        async.parallel(executables, function (err, results) {

            // exec('killall -9 phantomjs', function (error, stdout, stderr) {});

            console.log('Reports :' + Object.keys(coverageReport).length);

            var count = 0;

            for (var i = 0; i < results.length; i++) {
                count += results[i].length;
            }

            console.log(chalk.bgWhite('\nCompleted running ' + totalSpecs + ' spec' + (totalSpecs.length > 1 ? 's' : '') + ' in ' + (msToTime(Date.now() - startedTime)) + '\n'));

            console.table(table);

            if (failedSpecs.length > 0) {
                for (var i = 0; i < failedSpecs.length; i++) {
                    var spec = failedSpecs[i];
                    console.log(chalk.red.underline.bold(spec.fullName));
                    for (var j = 0; j < spec.failedExpectations.length; j++) {
                        console.log(new Array(3).join(' ') + (j + 1) + '. ' + chalk.yellow(spec.failedExpectations[j].message) + '\n');
                    }
                }
                grunt.fail.fatal(failedSpecs.length + ' Spec' + (failedSpecs.length > 1 ? 's' : '') + ' failed');
            } else {
                console.log('');
            }

            var fse = require('fs-extra');

            if(options.cover && options.coverage) {

                async.parallel([function (cb) {
                    if (Object.keys(coverageReport).length > 0) {
                        var tName = './.grunt/grunt-contrib-jasmine/temp';
                        fse.removeSync(tName);
                        console.log(chalk.green.italic('Generating Coverage report...'));
                        fse.ensureDirSync(tName);
                        fse.ensureDirSync('./coverage');
                        for (var i in coverageReport) {
                            fse.outputFileSync(tName + '/coverage_' + i + '.log', coverageReport[i]);
                            delete coverageReport[i];
                        }
                        var mergerPath = './node_modules/grunt-contrib-jasmine-phantom/node_modules/.bin/lcov-result-merger';

                        require('child_process').exec(mergerPath + " '" + tName + "/*.log' './coverage/lcov.log'", function (err) {
                            if (err) {
                                console.log(err);
                                console.log(chalk.red('Unable to generate Coverage report. Error while merging it'));
                            } else {
                                console.log(chalk.green.italic('Generated Coverage report!'));
                            }
                            fse.removeSync(tName);
                            cb(null, './coverage/lcov.log');
                        });
                    } else {
                        cb(null);
                    }
                }], function (errors, results) {
                    var lcovPath = results[0];

                    fs.readFile(lcovPath, "utf8", function (err, data) {

                        if (err) {
                            console.log('Something bad happened while reading lcov string');
                            throw err;
                        }

                        data = data.split('end_of_record');

                        var readBlock = function (cb) {
                            var results, name, gotHits, block, total;
                            block = this.block;
                            results = block.split('\n');
                            name = results.splice(0, 1).pop();
                            gotHits = total = 0;
                            results.forEach(function (line) {
                                try {
                                    line = line.split(':')[1].split(',');
                                    total += 1;
                                    if (+line[1] !== 0) {
                                        gotHits += 1;
                                    }
                                } catch (e) {

                                }
                            });
                            var percentage = (gotHits / total) * 100;
                            cb(null, {name: name, percentage: percentage});
                        };

                        var execute = [];

                        data.forEach(function (block) {
                            block = block.trim();
                            if (block.length > 0) {
                                execute[execute.length] = readBlock.bind({block: block});
                            }
                        });

                        async.parallel(execute, function (err, results) {

                            var grandTotal = 0;

                            results = results.sort(function (a, b) {
                                return a.percentage - b.percentage;
                            });

                            results.forEach(function (a) {
                                grandTotal += parseFloat(a.percentage);
                            });

                            var percentage = (grandTotal / results.length).toFixed(2);

                            fse.outputFileSync('./coverage.json', JSON.stringify({
                                percentage: percentage
                            }));

                            var eventPayLoad = {
                                percentage: percentage,
                                leastCovered: results.slice(0, 5),
                                lcovPath: lcovPath
                            }

                            console.log('\n' + chalk.green.bold('****************** Coverage Report ******************') + '\n');

                            console.log(chalk.green.bold.underline('Code coverage: ' + percentage) + '% \n');

                            var count = 0;

                            results = results.map(function (v) {
                                v.percentage = v.percentage.toFixed(2);
                                return v;
                            });

                            console.table(results);

                            if (options.coverage && typeof options.coverage.onCoverage === "function") {
                                options.coverage.onCoverage.call(eventPayLoad, function () {
                                    done();
                                });
                            } else {
                                done();
                            }

                        });
                    });


                });

            } else {
                done();
            }

        });

    });

};