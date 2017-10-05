const bcrypt = require('bcrypt');
const fs = require('fs');

const appConfig = require('../../config/app.config');
const models = require('../../models');

// TODO: refactor, add rejects handling (or rewrite to migrations)

const createInitialData = () =>
  new Promise(resolve => {

  });

module.exports = createInitialData;