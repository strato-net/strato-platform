const db = require('./connection');

const Contracts = db.sequelize.define('contracts', {
  name: {
    type: db.Sequelize.CHAR
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Contracts;