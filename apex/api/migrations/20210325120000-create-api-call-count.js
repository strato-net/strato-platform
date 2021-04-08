'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('ApiCallCounts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      apiReads: {type: Sequelize.INTEGER, allowNull: false},
      apiReadsTotal: {type: Sequelize.INTEGER, allowNull: false},
      apiWrites: {type: Sequelize.INTEGER, allowNull: false},
      apiWritesTotal: {type: Sequelize.INTEGER, allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false},
    });
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('ApiCallCounts');
  }
};
