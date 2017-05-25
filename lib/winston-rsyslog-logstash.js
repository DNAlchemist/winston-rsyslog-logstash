/*
 *
 * (C) 2013 Mikhalev Ruslan
 * MIT LICENCE
 *
 */

var net = require('net'),
    util = require('util'),
    os = require('os'),
    tls = require('tls'),
    fs = require('fs'),
    winston = require('winston'),
    common = require('winston/lib/winston/common');

var ECONNREFUSED_REGEXP = /ECONNREFUSED/;

var Rsyslog = exports.Rsyslog = function (options) {
    winston.Transport.call(this, options);
    options = options || {};

    this.name = 'rsyslog';
    this.localhost = options.localhost || os.hostname();
    this.type = options.type;
    this.tag = options.tag || 'apps';
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 514;
    this.facility = options.facility || 16;
    this.pid = options.pid || process.pid;
    this.max_connect_retries = ('number' === typeof options.max_connect_retries) ? options.max_connect_retries : 4;
    this.timeout_connect_retries = ('number' === typeof options.timeout_connect_retries) ? options.timeout_connect_retries : 100;
    this.retries = -1;

    // Support for winston build in rsyslog format
    // https://github.com/flatiron/winston/blob/master/lib/winston/common.js#L149
    this.rsyslog = options.rsyslog || false;

    // Connection state
    this.log_queue = [];
    this.connected = false;
    this.socket = null;

    // Miscellaneous options
    this.strip_colors = options.strip_colors || false;
    this.meta_defaults = options.meta || {};

    // We want to avoid copy-by-reference for meta defaults, so make sure it's a flat object.
    for (var property in this.meta_defaults) {
        if (typeof this.meta_defaults[property] === 'object') {
            delete this.meta_defaults[property];
        }
    }

    this.connect();
};

//
// Inherit from `winston.Transport`.
//
util.inherits(Rsyslog, winston.Transport);

//
// Define a getter so that `winston.transports.Syslog`
// is available and thus backwards compatible.
//
winston.transports.Rsyslog = Rsyslog;

Rsyslog.prototype.name = 'rsyslog';

Rsyslog.prototype.log = function (level, msg, meta, callback) {
    var self = this,
        meta = winston.clone(meta || {}),
        log_entry;

    for (var property in this.meta_defaults) {
        meta[property] = this.meta_defaults[property];
    }

    if (self.silent) {
        return callback(null, true);
    }

    if (self.strip_colors) {
        msg = msg.stripColors;

        // Let's get rid of colors on our meta properties too.
        if (typeof meta === 'object') {
            for (var property in meta) {
                meta[property] = meta[property].stripColors;
            }
        }
    }

    var ts = new Date().toISOString();
    log_entry = JSON.stringify(Object.assign({
        "@timestamp": ts,
        "@version": 1,
        "message": msg,
        "pid": this.pid,
        "level": level.toUpperCase()
    }, meta));

    if (!self.connected) {
        self.log_queue.push({
            entry: {level: level, timestamp: ts, message: log_entry},
            callback: function () {
                self.emit('logged');
                callback(null, true);
            }
        });
    } else {
        self.sendLog(log_entry, function () {
            self.emit('logged');
            callback(null, true);
        });
    }
};

Rsyslog.prototype.connect = function () {
    var tryReconnect = true;
    var self = this;
    this.retries++;
    this.connecting = true;
    this.terminating = false;

    this.socket = new net.Socket();

    this.socket.on('error', function (err) {
        self.connecting = false;
        self.connected = false;

        if (typeof(self.socket) !== 'undefined' && self.socket !== null) {
            self.socket.destroy();
        }

        self.socket = null;

        if (!ECONNREFUSED_REGEXP.test(err.message)) {
            tryReconnect = false;
            self.emit('error', err);
        }
    });

    this.socket.on('timeout', function () {
        if (self.socket.readyState !== 'open') {
            self.socket.destroy();
        }
    });

    this.socket.on('connect', function () {
        self.retries = 0;
    });

    this.socket.on('close', function (had_error) {
        self.connected = false;

        if (self.terminating) {
            return;
        }

        if (self.max_connect_retries < 0 || self.retries < self.max_connect_retries) {
            if (!self.connecting) {
                setTimeout(function () {
                    self.connect();
                }, self.timeout_connect_retries);
            }
        } else {
            self.log_queue = [];
            self.silent = true;
            self.emit('error', new Error('Max retries reached, transport in silent mode, OFFLINE'));
        }
    });

    this.socket.connect(self.port, self.host, function () {
        self.announce();
        self.connecting = false;
    });


};

Rsyslog.prototype.close = function () {
    var self = this;
    self.terminating = true;
    if (self.connected && self.socket) {
        self.connected = false;
        self.socket.end();
        self.socket.destroy();
        self.socket = null;
    }
};

Rsyslog.prototype.announce = function () {
    var self = this;
    self.connected = true;
    self.flush();
    if (self.terminating) {
        self.close();
    }
};

Rsyslog.prototype.flush = function () {
    var self = this;

    for (var i = 0; i < self.log_queue.length; i++) {
        self.sendLog(self.log_queue[i].entry, self.log_queue[i].callback);
    }
    self.log_queue.length = 0;
};

Rsyslog.prototype.sendLog = function (e, callback) {
    var severity = 7;
    if (winston.config.syslog["levels"][e.level] !== undefined) {
        severity = winston.config.syslog["levels"][e.level];
    }

    var pri = (this.facility << 3) + severity;
    var timestamp = e.timestamp;
    var buffer = new Buffer("<" + pri + ">" + timestamp + " " + this.localhost +
        " " + (this.type ? this.type + "/" : "") + this.tag + " " + e.message);

    var self = this;
    callback = callback || function () { };

    self.socket.write(buffer + '\n');
    callback();
};

Rsyslog.prototype.getQueueLength = function () {
    return this.log_queue.length;
};
