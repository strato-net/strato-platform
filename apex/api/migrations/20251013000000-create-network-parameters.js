'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('NetworkParameters', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      parameterName: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      parameterValue: {
        type: Sequelize.STRING,
        allowNull: false
      },
      blockNumber: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      timestamp: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
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
    return queryInterface.dropTable('NetworkParameters');
  }
};

