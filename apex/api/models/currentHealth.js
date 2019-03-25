'use strict';

module.exports = function(sequelize, DataTypes) {
    let CurrentHealth = sequelize.define('CurrentHealth', {
        processName : {type: DataTypes.STRING, defaultValue: false, allowNull: false},
        latestHealthStatus : {type: DataTypes.BOOLEAN, allowNull: false},
        latestCheckTimestamp: {
            type: DataTypes.DATE, //'TIMESTAMP',
            allowNull: false},
        lastFailureTimestamp : {
            type: DataTypes.DATE, //'TIMESTAMP',
            allowNull: false},
        ifBlocksValidInc: {type: DataTypes.BOOLEAN, allowNull: true}
    });
    CurrentHealth.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            latestHealthStatus: this.latestHealthStatus,
            latestCheckTimestamp: this.latestCheckTimestamp,
            lastFailureTimestamp: this.lastFailureTimestamp,
            ifBlocksValidInc: this.ifBlocksValidInc
        };
    };
    CurrentHealth.associate = function(models) {
        CurrentHealth.hasMany(models.HealthStat);
    };
    return CurrentHealth;
};
