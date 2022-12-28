/*Unused code notice. Node stats disabled, to be deprecated  #node-stats-deprecation
'use strict';

module.exports = function (sequelize, DataTypes) {
  const UsageStat = sequelize.define('UsageStat', {
    networkTxs: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    networkTxsTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    contractTypesAdded: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    contractTypesTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    contractCountsByType: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    contractFieldsAdded: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    contractFieldsTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    usersAdded: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    usersTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    apiReads: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    apiReadsTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    apiWrites: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    apiWritesTotal: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    periodSec: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false
    },
    submitted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  });
  UsageStat.prototype.toJson = function () {
    return {
      id: this.id,
      networkTxs: this.networkTxs,
      networkTxsTotal: this.networkTxsTotal,
      contractTypesAdded: this.contractTypesAdded,
      contractTypesTotal: this.contractTypesTotal,
      contractCountsByType: this.contractCountsByType,
      contractFieldsAdded: this.contractFieldsAdded,
      contractFieldsTotal: this.contractFieldsTotal,
      usersAdded: this.usersAdded,
      usersTotal: this.usersTotal,
      apiReads: this.apiReads,
      apiReadsTotal: this.apiReadsTotal,
      apiWrites: this.apiWrites,
      apiWritesTotal: this.apiWritesTotal,
      periodSec: this.periodSec,
      timestamp: this.timestamp,
      submitted: this.submitted,
    };
  };
  return UsageStat;
};
*/
