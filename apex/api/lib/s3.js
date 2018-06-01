const AWS = require('aws-sdk');
const appConfig = require('../config/app.config');

const s3 = new AWS.S3(appConfig.s3);

module.exports = s3;