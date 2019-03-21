'use strict';

module.exports = function(sequelize, DataTypes) {
    let StallStat = sequelize.define('StallStat', {
        blockType: {type: DataTypes.STRING, allowNull: true},
        blockCount: {type: DataTypes.INTEGER, allowNull: true},
        timestamp: {type: DataTypes.DATE, allowNull: true}
    });
    StallStat.prototype.toJson = function() {
        return {
            id: this.id,
            blockType: this.blockType,
            blockCount: this.blockCount,
            timestamp: this.timestamp
        };
    };
    StallStat.associate = function(models) {
        StallStat.belongsTo(models.CurrentHealth, {
            onDelete: "CASCADE",
            foreignKey: {
                allowNull: true
            }
        })
    };
    return StallStat;
};
