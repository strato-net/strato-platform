'use strict';

module.exports = function(sequelize, DataTypes) {
    let HealthStat = sequelize.define('HealthStat', {
        processName: {type: DataTypes.STRING, allowNull: true},
        HealthStat: {type: DataTypes.BOOLEAN, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });
    HealthStat.prototype.toJson = function() {
        return {
            id: this.id,
            processName: this.processName,
            HealthStat: this.HealthStat,
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
