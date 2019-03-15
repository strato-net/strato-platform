'use strict';

module.exports = function(sequelize, DataTypes) {
    let healthStat = sequelize.define('healthStat', {
        processName: {type: DataTypes.STRING, allowNull: true},
        HealthStatus: {type: DataTypes.BOOLEAN, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });
    healthStat.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            HealthStatus: this.HealthStatus,
            timestamp: this.timestamp
        };
    };
    healthStat.associate = function(models) {
        healthStat.belongsTo(models.Stat, {
            onDelete: "CASCADE",
            foreignKey: {
                allowNull: true
            }
        })
    };
    return healthStat;
};
