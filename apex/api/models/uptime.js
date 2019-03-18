'use strict';

module.exports = function(sequelize, DataTypes) {
    let Uptime = sequelize.define('Uptime', {
        blockType: {type: DataTypes.STRING, allowNull: true},
        blockCount: {type: DataTypes.INTEGER, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });
    Uptime.prototype.toJson = function() {
        return {
            id: this.id,
            blockType: this.blockType,
            blockCount: this.blockCount,
            timestamp: this.timestamp
        };
    };
    Uptime.associate = function(models) {
        Uptime.belongsTo(models.Stat, {
            onDelete: "CASCADE",
            foreignKey: {
                allowNull: true
            }
        })
    };
    return Uptime;
};
