const Sequelize = require('sequelize');
const env = process.env.NODE_ENV || 'development';
const config = require('./config.json')[env];
config.port = process.env.postgres_port || config.port;
const db = {};

const sequelize = new Sequelize(config.database, config.username, config.password, config);

sequelize.authenticate()
  .then(() => {
    console.log('Connection has been established with ' + config.database);
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
    throw err;
  });

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
