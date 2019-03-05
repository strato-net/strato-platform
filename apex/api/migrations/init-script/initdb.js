const env       = process.env.NODE_ENV || 'development';
const config    = require(__dirname + '/../../config/config.json')[env];
config.port = process.env.postgresPort || config.port;

const pgtools = require('pgtools');

module.exports = function initdb() {
  // create db in postgres if does not exist
  const pgToolsConfig = {
    user: config.username,
    password: config.password,
    port: config.port,
    host: config.host,
  };
  return new Promise((resolve, reject) => {
    pgtools.createdb(pgToolsConfig, config.database, function (err, res) {
      if (err) {
        if (err.name === "duplicate_database") {
          console.log("Apex database exists")
        } else {
          return reject(err);
        }
      }
      return resolve();
    })
  })
};

module.exports.dropdb = function() {
  const pgToolsConfig = {
    user: config.username,
    password: config.password,
    port: config.port,
    host: config.host,
  };
  return new Promise((resolve, reject) => {
      pgtools.dropdb(pgToolsConfig, config.database, function (err, res) {
        return err ? reject(err) : resolve();
      })
  })
};

