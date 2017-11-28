const db = require('./connection');

const User = db.sequelize.define('users', {
  id: {
    type: db.Sequelize.INTEGER,
    primaryKey: true
  },
  name: {
    type: db.Sequelize.STRING(512)
  }
}, { freezeTableName: true, timestamps: false });

module.exports = User;