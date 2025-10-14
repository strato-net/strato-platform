'use strict';

module.exports = function(sequelize, DataTypes) {
    const NetworkParameter = sequelize.define('NetworkParameter', {
        parameterName: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        parameterValue: {
            type: DataTypes.STRING,
            allowNull: false
        },
        blockNumber: {
            type: DataTypes.BIGINT,
            allowNull: false
        },
        timestamp: {
            type: DataTypes.BIGINT,
            allowNull: false
        }
    });

    NetworkParameter.prototype.toJson = function() {
        return {
            id: this.id,
            parameterName: this.parameterName,
            parameterValue: this.parameterValue,
            blockNumber: this.blockNumber,
            timestamp: this.timestamp,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    };

    return NetworkParameter;
};

