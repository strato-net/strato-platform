'use strict';

module.exports = function(sequelize, DataTypes) {
    const HealthStat = sequelize.define('HealthStat', {
        processName: {type: DataTypes.STRING, allowNull: true},
        HealthStatus: {type: DataTypes.BOOLEAN, allowNull: true},
        timestamp: {
            type: DataTypes.DATE,
            allowNull: true}
    });
    HealthStat.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            HealthStatus: this.HealthStatus,
            timestamp: this.timestamp
        };
    };
    return HealthStat;
};
