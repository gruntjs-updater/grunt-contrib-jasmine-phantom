
'use strict';

// [ [ id, symbol, path, indent, type, name, duration, status, failedExpectations, passedExpectations ] ]

var phantom = {};

var order = [];

var indentLevel = 0;

var preReport = {};

var path = "";

var timings = {};

function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

if (window._phantom) {
    console.log = function () {
        phantom.sendMessage('console', Array.prototype.slice.apply(arguments).join(', '));
    };
}

function set(obj, path, value) {
    var schema = obj;  // a moving reference to internal objects within obj
    var pList = path.split('-|-').filter(function(v, i, arr) { return v != arr[i - 1] });
    var len = pList.length;
    for(var i = 0; i < len-1; i++) {
        var elem = pList[i];
        if( !schema[elem] ) schema[elem] = {}
        schema = schema[elem];
    }

    schema[pList[len-1]] = value;
}

var current = getParameterByName('spec');

if(current) {
    window.specFilter = [current];
}

var currentResult = {};

var currentSuite = "", currentSpec = "", deepPath = "currentResult";

var startTime = Date.now();

function popLast(l) {
    deepPath = deepPath.split('-|-');
    deepPath.splice(l || -1).pop();
    deepPath = deepPath.join('-|-');
}

(function () {

    phantom.sendMessage = function () {
        var args = [].slice.call(arguments);
        var payload = stringify(args);
        if (window._phantom) {
            // alerts are the communication bridge to grunt
            alert(payload);
        }
    };

    function PhantomReporter() {
        this.started = false;
        this.finished = false;
        this.suites_ = [];
        this.results_ = {};
        this.buffer = '';
    }

    PhantomReporter.prototype.jasmineStarted = function () {
        this.started = true;
    };

    PhantomReporter.prototype.specStarted = function (specMetadata) {
        // console.log(specMetadata);
        if (specMetadata.fullName.indexOf(current) === 0) {
            deepPath += ("-|-specs-|-" + specMetadata.description);
            set(window, deepPath, specMetadata);
            // specMetadata.startTime = (new Date()).getTime();
            /*phantom.sendMessage('logIt:start', {
             file : current,
             id : specMetadata.id
             }.id);*/
            timings[specMetadata.id] = Date.now();
        }
    };

    PhantomReporter.prototype.suiteStarted = function (suiteMetadata) {

        if (suiteMetadata.fullName.indexOf(current) === 0) {

            deepPath += ("-|-suites-|-" + suiteMetadata.description);

            suiteMetadata.startTime = (new Date()).getTime();

            var d = {
                specs : {},
                suites : {},
                duration : null
            };

            set(window, deepPath, d);

            timings[suiteMetadata.id] = Date.now();

            // phantom.sendMessage('jasmine.suiteStarted', suiteMetadata);
        }

    };

    window.$jasmineDone = function() {

        if(window.blanket) {
            phantom.sendMessage('lcov', { data: window._$blanket_LCOV, file: current });
        }

        console.log('Jasmine done ' + current);

        this.finished = true;

        var _specs = getParameterByName('_spec');

        phantom.sendMessage('jasmine.completedFile', {
            data : currentResult.suites[current],
            file : current,
            timings : timings,
            duration : (Date.now() - startTime)
        });

        if (_specs) {
            // console.log(_specs);
            _specs = _specs.split('|');
            var first = _specs.splice(0, 1);
            var path = window.location.pathname + '?spec=' + first;
            if (_specs.length > 0) {
                path += '&_spec=' + _specs.join('|');
            }
            var pid = getParameterByName('pid');
            path = path + (path.indexOf('?') > -1 ? '&' : '?') + 'pid=' + window.___pid___;
            // document.location.replace('http://localhost/');
            document.location.replace(path);

        } else {
            window.$jasmineDoneCalled = true;
            phantom.sendMessage('jasmine.jasmineDone');
        }
    }

    if(!window.blanket) {
        PhantomReporter.prototype.jasmineDone = window.$jasmineDone;
    }

    PhantomReporter.prototype.suiteDone = function (suiteMetadata) {
        if (suiteMetadata.fullName.indexOf(current) === 0) {
            // suiteMetadata.duration = (new Date()).getTime() - suiteMetadata.startTime;
            timings[suiteMetadata.id] = Date.now() - timings[suiteMetadata.id];
            set(window, deepPath + '-|-duration', timings[suiteMetadata.id]);
            popLast(-2);

            // phantom.sendMessage('jasmine.suiteDone', suiteMetadata);
        }
    };

    PhantomReporter.prototype.specDone = function (specMetadata) {

        if (specMetadata.fullName.indexOf(current) === 0) {

            timings[specMetadata.id] = Date.now() - timings[specMetadata.id];

            // Quick hack to alleviate cyclical object breaking JSONification.
            for (var ii = 0; ii < specMetadata.failedExpectations.length; ii++) {
                var item = specMetadata.failedExpectations[ii];
                if (item.expected) {
                    item.expected = stringify(item.expected);
                }
                if (item.actual) {
                    item.actual = stringify(item.actual);
                }
            }

            set(window, deepPath, specMetadata);
            set(window, deepPath + '-|-duration', timings[specMetadata.id]);
            popLast(-2);

            /*phantom.sendMessage('logIt:end', {
             file : current,
             id : specMetadata.id
             }.id);*/



            // phantom.sendMessage('jasmine.specDone', specMetadata);
        }
    };

    function stringify(obj) {
        if (typeof obj !== 'object') return obj;

        var cache = [], keyMap = [], index;

        var string = JSON.stringify(obj, function (key, value) {
            // Let json stringify falsy values
            if (!value) return value;

            try {
                // If we're a node
                if (typeof(Node) !== 'undefined' && value instanceof Node) return '[ Node ]';

                // jasmine-given has expectations on Specs. We intercept to return a
                // String to avoid stringifying the entire Jasmine environment, which
                // results in exponential string growth
                if (value instanceof jasmine.Spec) return '[ Spec: ' + value.description + ' ]';

                // If we're a window (logic stolen from jQuery)
                if (value.window && value.window === value.window.window) return '[ Window ]';

                // Simple function reporting
                if (typeof value === 'function') return '[ Function ]';

                if (typeof value === 'object' && value !== null) {

                    if (index = cache.indexOf(value) !== -1) {
                        // If we have it in cache, report the circle with the key we first found it in
                        return '[ Circular {' + (keyMap[index] || 'root') + '} ]';
                    }
                    cache.push(value);
                    keyMap.push(key);
                }
            } catch (e) {
                return "[Object]";
            }
            return value;
        });

        return string;
    }

    var reporter = new PhantomReporter();

    jasmine.getEnv().addReporter(reporter);

}());
