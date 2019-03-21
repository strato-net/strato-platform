/* jshint esnext: true */
require('co-mocha')
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');
const nodeHealthCheckJs = require('../daemons/node-health-check')
const sampleResponse = require('./testdata/promethusResponse')
const config = require('../config/app.config');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

describe('Tests - Node-level Health Check', function* () {

    it('Health check should fail if prometheus timestamp is out of tolerance range', function* () {
        let testObj = sampleResponse;
        const currentTime = Date.now() / 1000;
        testObj.result[0].value[0] = currentTime - config.healthCheck.maxResponseRange ;
        const res = nodeHealthCheckJs.compareTimestamp(testObj);
        const stat = nodeHealthCheckJs.updateHealthStat(res);
        assert.equal(stat, false, "Failure status");
        // further check for database updates here

    })

    it('create entries in HealthStat table', function* () {

    })

    it('create entries in StallStat table', function* () {

    })

    it('check updates in CurrentHealth table', function* () {

    })

    it('check emission of GET_HEALTH', function* () {

    })

    it('check emission of GET_NODE_UPTIME', function* () {

    })
})
