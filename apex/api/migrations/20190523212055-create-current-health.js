'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('CurrentHealths', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      processName: {
        type: Sequelize.STRING
      },
      latestHealthStatus : {type: Sequelize.BOOLEAN, allowNull: false},
      latestCheckTimestamp: {
        type: Sequelize.DATE, //'TIMESTAMP',
        allowNull: false},
      lastFailureTimestamp : {
        type: Sequelize.DATE, //'TIMESTAMP',
        allowNull: false},
      additionalInfo: {type: Sequelize.JSONB, allowNull: true},
      isBlocksValidInc: {type: Sequelize.BOOLEAN, allowNull: true},
      isLastPending: {type: Sequelize.BOOLEAN, allowNull: true},
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('CurrentHealths');
  }
};
