const Sequelize = require('sequelize');
const env       = process.env.NODE_ENV || 'development';
const config    = require('./config.json')[env];

const sequelize = new Sequelize(config.database, config.username, config.password, config);

sequelize.authenticate()
.then(() => {
  console.log('Connection has been established successfully.');
})
.catch(err => {
  console.log('Unable to connect to the database:', err);
});

module.exports = sequelize;