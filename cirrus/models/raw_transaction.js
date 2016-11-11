/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('raw_transaction', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      //primaryKey: true,
      autoIncrement: true
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false
    },
    from_address: {
      type: DataTypes.STRING,
      allowNull: false,
      //primaryKey: true
    },
    nonce: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    gas_price: {
      type: 'NUMERIC',
      allowNull: false
    },
    gas_limit: {
      type: 'NUMERIC',
      allowNull: false
    },
    to_address: {
      type: DataTypes.STRING,
      allowNull: true,
      primaryKey: true
    },
    value: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    code_or_data: {
      type: 'BYTEA',
      allowNull: false
    },
    r: {
      type: DataTypes.STRING,
      allowNull: false
    },
    s: {
      type: DataTypes.STRING,
      allowNull: false
    },
    v: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    block_number: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    tx_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    from_block: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    }
  }, {
    tableName: 'raw_transaction',
    timestamps: false
  });
};
