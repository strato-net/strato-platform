'use strict';

module.exports = function(sequelize, DataTypes) {
    let HealthStat = sequelize.define('HealthStat', {
        processName: {type: DataTypes.STRING, allowNull: true},
        HealthStatus: {type: DataTypes.BOOLEAN, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });
    HealthStat.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            HealthStatus: this.HealthStatus,
            timestamp: this.timestamp
        };
    };
    HealthStat.associate = function(models) {
        HealthStat.belongsTo(models.CurrentHealth, {
            onDelete: "CASCADE",
            foreignKey: {
                allowNull: true
            }
        })
    };
    return HealthStat;
};
