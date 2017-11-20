const db = require('./connection');

const Users = db.sequelize.define('users', {
  name: {
    type: db.Sequelize.CHAR
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Users;