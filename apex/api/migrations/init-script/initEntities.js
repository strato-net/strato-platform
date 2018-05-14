const co = require('co');
const blockappsRest = require('blockapps-rest').rest;
const bcrypt = require('bcrypt');
const models = require('../../models');
const appConfig = require('../../config/app.config');

const createInitialEnities = () =>
  co(function* () {
    const users = ['test1', 'test2', 'test3'];
    const entities = [`Raven's Warehouse`, `Enzo's Electronics`, `Radiks`];

    for (let i = 0; i < 3; i++) {
      let user = yield models.User.find({ where: { username: users[i] } });
      if (!user) {
        const blocUser = yield blockappsRest.createUser(users[i], '1234', true);
        user = yield models.User.create({
          username: users[i],
          passwordHash: bcrypt.hashSync('1234', appConfig.passwordSaltRounds),
          accountAddress: blocUser.address
        })
      }

      let entity = yield models.Entity.find({ where: { name: entities[i] } });
      if (!entity) {
        entity = yield models.Entity.create({
          name: entities[i],
          enodeUrl: `enode://`,
          status: `Member`
        });
        let entityUser = yield models.EntityUser.create({
          email: 'a@a.com',
          admin: true,
          EntityId: entity.id,
          UserId: user.id
        })
      }
    }
  })

module.exports = createInitialEnities;
