'use strict';

module.exports = function(sequelize, DataTypes) {
    const CurrentHealth = sequelize.define('CurrentHealth', {
        processName : {type: DataTypes.STRING, defaultValue: false, allowNull: false},
        latestHealthStatus : {type: DataTypes.BOOLEAN, allowNull: false},
        latestCheckTimestamp: {
            type: DataTypes.DATE, //'TIMESTAMP',
            allowNull: false},
        lastFailureTimestamp : {
            type: DataTypes.DATE, //'TIMESTAMP',
            allowNull: false},
        additionalInfo: {type: DataTypes.JSONB, allowNull: true},
        validBlocksIncreased: {type: DataTypes.BOOLEAN, allowNull: true},
        hasPendingTxs: {type: DataTypes.BOOLEAN, allowNull: true}
    });
    CurrentHealth.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            latestHealthStatus: this.latestHealthStatus,
            latestCheckTimestamp: this.latestCheckTimestamp,
            lastFailureTimestamp: this.lastFailureTimestamp,
            additionalInfo: this.additionalInfo,
            validBlocksIncreased: this.validBlocksIncreased,
            hasPendingTxs: this.hasPendingTxs
        };
    };
    return CurrentHealth;
};
