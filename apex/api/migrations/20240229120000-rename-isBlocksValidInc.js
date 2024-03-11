'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.renameColumn('CurrentHealths', 'isBlocksValidInc', 'validBlocksIncreased');
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.renameColumn('CurrentHealths', 'validBlocksIncreased', 'isBlocksValidInc');
  }
};
