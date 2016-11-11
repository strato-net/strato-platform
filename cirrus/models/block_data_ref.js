/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block_data_ref', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      //primaryKey: true,
      autoIncrement: true
    },
    parent_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    uncles_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    coinbase: {
      type: DataTypes.STRING,
      allowNull: false
    },
    state_root: {
      type: DataTypes.STRING,
      allowNull: false
    },
    transactions_root: {
      type: DataTypes.STRING,
      allowNull: false
    },
    receipts_root: {
      type: DataTypes.STRING,
      allowNull: false
    },
    log_bloom: {
      type: 'BYTEA',
      allowNull: false
    },
    difficulty: {
      type: 'NUMERIC',
      allowNull: false
    },
    number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    gas_limit: {
      type: 'NUMERIC',
      allowNull: false
    },
    gas_used: {
      type: 'NUMERIC',
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false
    },
    extra_data: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nonce: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    mix_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    block_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'block',
        key: 'id'
      }
    },
    hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    pow_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    is_confirmed: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    total_difficulty: {
      type: 'NUMERIC',
      allowNull: false
    }
  }, {
    tableName: 'block_data_ref',
    timestamps: false
  });
};
