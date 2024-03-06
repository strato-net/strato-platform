'use strict';
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.renameColumn('CurrentHealths', 'isLastPending', 'hasPendingTxs');
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.renameColumn('CurrentHealths', 'hasPendingTxs', 'isLastPending');
  }
};
