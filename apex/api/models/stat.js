'use strict';

module.exports = function(sequelize, DataTypes) {
    let Stat = sequelize.define('Stat', {
        processName : {type: DataTypes.STRING, defaultValue: false, allowNull: false},
        latestHealthStatus : {type: DataTypes.BOOLEAN, allowNull: true},
        latestCheckTimestamp: {type: DataTypes.STRING, allowNull: true},
        lastFailureTimestamp : {type: DataTypes.STRING, allowNull: true},
        ifBlocksValidInc: {type: DataTypes.BOOLEAN, allowNull: true}
    });
    Stat.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            latestHealthStatus: this.latestHealthStatus,
            latestCheckTimestamp: this.latestCheckTimestamp,
            lastFailureTimestamp: this.lastFailureTimestamp,
            ifBlocksValidInc: this.ifBlocksValidInc
        };
    };
    Stat.associate = function(models) {
        Stat.hasMany(models.healthStat);
    };
    return Stat;
};
