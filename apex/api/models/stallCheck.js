'use strict';

module.exports = function(sequelize, DataTypes) {
    let StallCheck = sequelize.define('StallCheck', {
        blockType: {type: DataTypes.STRING, allowNull: true},
        blockCount: {type: DataTypes.INTEGER, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });
    StallCheck.prototype.toJson = function() {
        return {
            id: this.id,
            blockType: this.blockType,
            blockCount: this.blockCount,
            timestamp: this.timestamp
        };
    };
    StallCheck.associate = function(models) {
        StallCheck.belongsTo(models.Stat, {
            onDelete: "CASCADE",
            foreignKey: {
                allowNull: true
            }
        })
    };
    return StallCheck;
};
