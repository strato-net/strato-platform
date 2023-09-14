const pgtools = require('pgtools');

const env       = process.env.NODE_ENV || 'development';
const config    = require(__dirname + '/../../config/config.json')[env];
config.port = process.env.postgres_port || config.port;


function createdb() {
  (async () => {
    // create db in postgres if does not exist
    const pgToolsConfig = {
      user: config.username,
      password: config.password,
      port: config.port,
      host: config.host,
    };
    try {
      await pgtools.createdb(pgToolsConfig, config.database)
      console.log(`Apex database for env ${env} was created successfully`)
    } catch (err) {
      if (err.name === "duplicate_database") {
        console.log("Apex database exists")
      } else {
        throw err
      }
    }
  })();
}

function dropdb() {
  (async () => {
    const pgToolsConfig = {
      user: config.username,
      password: config.password,
      port: config.port,
      host: config.host,
    };
    await pgtools.dropdb(pgToolsConfig, config.database)
    console.log(`Apex database for env ${env} was dropped successfully`)
  })()
}

module.exports = {
  createdb,
  dropdb,
};
