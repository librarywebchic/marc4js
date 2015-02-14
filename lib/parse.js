'use strict';

var Transform = require('stream').Transform;
var util = require('util');
var Util = require('./util');
var ControlField = require('./marc/control_field');
var DataField = require('./marc/data_field');
var Record = require('./marc/record');
var Leader = require('./marc/leader');
var MarcError = require('./marc_error');

module.exports = function() {
    var callback, called, records, data, options, parser;
    if (arguments.length === 3) {
        data = arguments[0];
        options = arguments[1];
        callback = arguments[2];
    } else if (arguments.length === 2) {
        if (typeof arguments[0] === 'string') {
            data = arguments[0];
        } else {
            options = arguments[0];
        }
        if (typeof arguments[1] === 'function') {
            callback = arguments[1];
        } else {
            options = arguments[1];
        }
    } else if (arguments.length === 1) {
        if (typeof arguments[0] === 'function') {
            callback = arguments[0];
        } else {
            options = arguments[0];
        }
    }
    if (options == null) {
        options = {};
    }
    parser = new MarcParser(options);
    if (data) {
        process.nextTick(function() {
            parser.write(data);
            return parser.end();
        });
    }
    if (callback) {
        called = false;
        records = [];
        //chunks = options.objname ? {} : [];
        parser.on('data', function(record) {
            records.push(record);
            //return _results;
        });
        parser.on('error', function(err) {
            called = true;
            return callback(err);
        });
        parser.on('end', function() {
            if (!called) {
                return callback(null, records);
            }
        });
    }
    return parser;
};

var MarcParser = function (opts) {
    opts = opts || {};
    opts.objectMode = true; // this has to be true. Emit only Record objects

    Transform.call(this, opts);

    this.prevData = null;
    this.prevStart = -1;
};

util.inherits(MarcParser, Transform);

MarcParser.prototype._transform = function (chunk, encoding, callback) {
    if (typeof chunk == 'string' || chunk instanceof String) {
        chunk = new Buffer(chunk, encoding);
    }
    var err;
    try {
        var data = chunk;
        var start = 0;
        var pos = 0;
        var len = data.length;
        if (len === 0) return;
        while (pos <= len) {
            while (pos <= len && data[pos] !== 29) {
                pos++;
            }
            if (pos <= len) {
                this.count++;
                var raw;
                if (this.prevStart !== -1) {
                    var prevLen = this.prevData.length - this.prevStart;
                    raw = new Buffer(prevLen + pos + 1);

                    this.prevData.copy(raw, 0, this.prevStart, this.prevData.length);
                    data.copy(raw, prevLen, 0, pos);
                    this.prevStart = -1;
                } else {
                    raw = new Buffer(pos - start + 1);
                    data.copy(raw, 0, start, pos);
                }

                var record;
                try {
                    record = this._parse(raw);
                } catch (err) {
                    this.emit("error", err);
                }

                this.push(record);
                pos++;
                start = pos;
            }
        }
        if (pos !== len) {
            this.prevData = data;
            this.prevStart = start;
        } else {
            this.prevStart = -1; // Marque qu'on n'a rien à garder du précédent buffer
        }
        return callback();
    } catch (_error) {
        err = _error;
        return this.emit('error', err);
    }
};

MarcParser.prototype._parse = function (data) {
    var record = new Record();
    var leader = new Leader();
    leader.unmarshal(data.toString('utf8', 0, 24));
    record.leader = leader;

    var encoding = Util.codeToEncoding(leader.charCodingScheme);

    var directoryLength = leader.baseAddressOfData - (24 + 1);
    if ((directoryLength % 12) != 0) {
        throw new MarcError("invalid directory");
    }

    var size = directoryLength / 12;

    for (var i = 0; i < size; i++) {
        var offset = 24 + i * 12;
        var tag = data.toString('utf8', offset, offset + 3);
        var len = parseInt(data.toString('utf8', offset + 3, offset + 7), 0) - 1;
        var pos = parseInt(data.toString('utf8', offset + 7, offset + 12), 0) + 25 + directoryLength;
        var value = data.toString(encoding, pos, pos + len);

        if (data.toString('utf8', pos + len, pos + len + 1) != '\x1e') {
            throw new MarcError("expected field terminator at end of field");
        }

        var field;
        if (Util.isControlField(tag)) {
            field = new ControlField();
            field.data = value;
        } else {
            field = new DataField();
            field.unmarshal(value);
        }
        field.tag = tag;
        record.addVariableField(field);
    }
    return record;
};


module.exports.MarcParser = MarcParser;