/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('storage', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    address_state_ref_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'address_state_ref',
        key: 'id'
      }
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false
    },
    value: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'storage'
  });
};
