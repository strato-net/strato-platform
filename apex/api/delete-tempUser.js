/* For one-time use, to delete the created temp_user table */

const env       = process.env.NODE_ENV || 'development';
const config    = require('./config/config.json')[env];
config.port     = process.env.postgres_port || config.port;
const Sequelize = require('sequelize');

const sequelize = new Sequelize(config.database, config.username, config.password, config);

sequelize.authenticate()
  .then(() => {
    console.log('Connection has been established with ' + config.database);
    sequelize.query('DROP TABLE temp_user').then(() => {
      console.log('Table deletion successful');
      process.exit(1);
    })
    .catch(err => {
      console.error('Could not delete table:', err);
      process.exit(1);
    })
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
    process.exit(1);
  });
