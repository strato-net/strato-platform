/* jshint esnext: true */
/* jshint node: true */
// const bcrypt = require('bcrypt');
// const fs = require('fs');
// const randToken = require('rand-token');
//
// const appConfig = require('../../config/app.config');
const models = require('../../models');

// TODO: refactor, add rejects handling (or rewrite to migrations)
const createInitialData = () =>
  new Promise(resolve => {
    models.Role.count().then(count => {
      console.log("Count is " + count);
      if (count) {
        return resolve();
      }
      console.log('Default data is being created...');
      resolve();

      });
    });

module.exports = createInitialData;
