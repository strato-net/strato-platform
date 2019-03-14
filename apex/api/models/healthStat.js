'use strict';

module.exports = function(sequelize, DataTypes) {
    let healthStat = sequelize.define('healthStat', {
        processName: {type: DataTypes.STRING, allowNull: true},
        HealthStatus: {type: DataTypes.STRING, allowNull: true},
        timestamp: {type: DataTypes.STRING, allowNull: true}
    });

    //healthStat.associate = function(models) {
      //  healthStat.belongsTo(models.Node, {
        //    onDelete: "CASCADE",
          //  foreignKey: {
            //    allowNull: false
           // }
       // })
    //};

    return healthStat;
};
