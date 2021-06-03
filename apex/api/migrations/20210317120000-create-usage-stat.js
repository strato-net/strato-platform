'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('UsageStats', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      networkTxs: {type: Sequelize.INTEGER, allowNull: false},
      networkTxsTotal: {type: Sequelize.INTEGER, allowNull: false},
      contractTypesAdded: {type: Sequelize.INTEGER, allowNull: false},
      contractTypesTotal: {type: Sequelize.INTEGER, allowNull: false},
      contractCountsByType: {type: Sequelize.JSONB, allowNull: false},
      contractFieldsAdded: {type: Sequelize.INTEGER, allowNull: false},
      contractFieldsTotal: {type: Sequelize.INTEGER, allowNull: false},
      usersAdded: {type: Sequelize.INTEGER, allowNull: false},
      usersTotal: {type: Sequelize.INTEGER, allowNull: false},
      apiReads: {type: Sequelize.INTEGER, allowNull: false},
      apiReadsTotal: {type: Sequelize.INTEGER, allowNull: false},
      apiWrites: {type: Sequelize.INTEGER, allowNull: false},
      apiWritesTotal: {type: Sequelize.INTEGER, allowNull: false},
      periodSec: {type: Sequelize.INTEGER, allowNull: false},
      timestamp: {type: Sequelize.DATE, allowNull: false},
      submitted: {type: Sequelize.BOOLEAN, allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('UsageStats');
  }
};
