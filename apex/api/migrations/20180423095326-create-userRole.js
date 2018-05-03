'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('UserRole', {
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      RoleId: {
        type: Sequelize.INTEGER,
        references: {
          model: 'Roles',
          key: 'id'
        },
        allowNull: false,
        primaryKey: true,
        onDelete: 'cascade',
        onUpdate: 'cascade'
      },
      UserId: {
        type: Sequelize.INTEGER,
        references: {
          model: 'Users',
          key: 'id'
        },
        allowNull: false,
        primaryKey: true,
        onDelete: 'cascade',
        onUpdate: 'cascade'
      },
    });
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable('UserRole');
  }
};
