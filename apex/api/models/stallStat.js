'use strict';

module.exports = function(sequelize, DataTypes) {
    const StallStat = sequelize.define('StallStat', {
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
    return StallStat;
};
