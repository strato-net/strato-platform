const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../../config/config.json')[env];

const pgtools = require('pgtools');

function initdb() {
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

function dropdb() {
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

module.exports = {
  initdb,
  dropdb
}
