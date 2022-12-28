/*Unused code notice. Api counter disabled, to be deprecated  #api-counter-deprecation
'use strict';

module.exports = function (sequelize, DataTypes) {
  const ApiCallCount = sequelize.define('ApiCallCount', {
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
  });
  ApiCallCount.prototype.toJson = function () {
    return {
      id: this.id,
      apiReadsTotal: this.apiReadsTotal,
      apiReads: this.apiReads,
      apiWritesTotal: this.apiWritesTotal,
      apiWrites: this.apiWrites,
    };
  };
  return ApiCallCount;
};
*/
