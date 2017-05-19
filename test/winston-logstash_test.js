process.env.NODE_ENV = 'test';

var chai = require('chai'),
    expect = chai.expect,
    net = require('net'),
    tls = require('tls'),
    fs = require('fs'),
    winston = require('winston'),
    timekeeper = require('timekeeper'),
    freezed_time = new Date(1330688329321);

chai.config.includeStack = true;

require('../lib/winston-rsyslog-logstash');

describe('winston-rsyslog-logstash transport', function () {
    const port = 28777;
    function mergeObject(source, target) {
        const result = {};

        for (const attrName in source) {
            result[attrName] = source[attrName];
        }

        for (const attrName in target) {
            result[attrName] = target[attrName];
        }

        return result;
    }

    function createTestServer(port, on_data) {
        const server = net.createServer(function (socket) {
            socket.on('end', function () {
            });
            socket.on('data', on_data);
        });
        server.listen(port, function () {
        });

        return server;
    }

    function createLogger(port, secure, caFilePath, extraOptions) {
        var transportsConfiguration = {
            port: port,
            localhost: 'localhost'
        };

        if (extraOptions && typeof extraOptions === 'object') {
            transportsConfiguration = mergeObject(transportsConfiguration, extraOptions);
        }

        return new (winston.Logger)({
            transports: [
                new (winston.transports.Rsyslog)(transportsConfiguration)
            ]
        });
    }

    describe('with rsyslog server', function () {
        var test_server, logger, port = 28777;

        beforeEach(function (done) {
            timekeeper.freeze(freezed_time);
            done();
        });

        it('send logs over TCP as valid message', function (done) {
            const expected = /<134>[\S]* localhost apps {"@timestamp":"[^"]*","@version":1,"message":"hello world","pid":\d*,"level":"INFO","stream":"sample"}\n/;
            logger = createLogger(port);

            test_server = createTestServer(port, function (data) {
                const response = data.toString();
                expect(response).to.be.matches(expected);
                done();
            });

            logger.log('info', 'hello world', {stream: 'sample'});
        });

        it('send with different log levels', function (done) {

            const expected = /<134>[\S]* localhost apps {"@timestamp":"[^"]*","@version":1,"message":"hello world","pid":\d*,"level":"INFO","stream":"sample"}\n<131>[\S]* localhost apps {"@timestamp":"[^"]*","@version":1,"message":"hello world","pid":\d*,"level":"ERROR","stream":"sample"}\n/;
            logger = createLogger(port);

            test_server = createTestServer(port, function (data) {
                const response = data.toString();
                expect(response).to.be.matches(expected);
                done();
            });

            logger.log('info', 'hello world', {stream: 'sample'});
            logger.log('error', 'hello world', {stream: 'sample'});

        });

        it('send with overrided meta data', function(done) {
            logger = createLogger(port, false, '', { meta: { stream: 'sample' } });
            test_server = createTestServer(port, function (data) {
                const response = data.toString();
                const expected = /<134>[\S]* localhost apps {"@timestamp":"[^"]*","@version":1,"message":"hello world","pid":\d*,"level":"INFO","stream":"sample"}\n/;

                expect(response).to.be.matches(expected);
                done();
            });

            logger.log('info', 'hello world', {stream: 'no-sample'});
        });

        // Teardown
        afterEach(function (done) {
            if (logger) {
                logger.close();
            }
            timekeeper.reset();
            if (test_server) {
                test_server.close(function () {
                    test_server = null;
                    logger = null;
                    done();
                });
            }
        });

    });

    describe('without rsyslog server', function () {

        it('fallback to silent mode if rsyslog server is down', function (done) {
            const logger = createLogger(28747);

            logger.transports.rsyslog.on('error', function (err) {
                expect(logger.transports.rsyslog.silent).to.be.true;
                done();
            });

            logger.log('info', 'hello world', {stream: 'sample'});
        });

        it('emit an error message when it fallback to silent mode', function (done) {
            const logger = createLogger(28747);
            var called = true;

            logger.transports.rsyslog.on('error', function (err) {
                if (/OFFLINE$/.test(err.message)) {
                    expect(logger.transports.rsyslog.retries).to.be.equal(4);
                    expect(logger.transports.rsyslog.silent).to.be.true;

                    if (called) {
                        done();
                    }

                    called = false;
                }
            });
            // Wait for timeout for logger before sending first message
            const interval = setInterval(function () {
                logger.log('info', 'hello world', {stream: 'sample'});
                clearInterval(interval);
            }, 400);

        });
    });
});


