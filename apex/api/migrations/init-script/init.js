const models = require('../../models');

// TODO: refactor, add rejects handling (or rewrite to migrations)
const createInitialData = () =>
  new Promise(resolve => {
    models.Role.count().then(count => {
      if (count) {
        return resolve();
      }
      console.log('Default data is being created...');

      // Create default roles
      models.Role.bulkCreate([{name: "admin"}, {name: "developer"}], {individualHooks: true}).then((createdRoles) => {
        return resolve();
      });
    });
  });

module.exports = createInitialData;
