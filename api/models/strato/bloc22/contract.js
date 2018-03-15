const db = require('./connection');

const Contract = db.sequelize.define('contracts', {
  id: {
    type: db.Sequelize.INTEGER,
    primaryKey: true
  },
  name: {
    type: db.Sequelize.STRING(512)
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Contract;