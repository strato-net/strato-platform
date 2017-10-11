const bcrypt = require('bcrypt');
const fs = require('fs');
const randToken = require('rand-token');

const appConfig = require('../../config/app.config');
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
      models.Role.bulkCreate([{name: "admin"}], {individualHooks: true}).then((createdRoles) => {
        if (!process.env['USER_NAME'] || !process.env['USER_PASSWORD']) {
          console.log(`User name and password pair was not provided - not creating the initial user, generating USERKEY file`);
          const userkey = randToken.uid(64);
          // Create USERKEY file
          fs.writeFile("USERKEY", userkey, function(err) {
            if(err) {
              return console.log(err);
            }
            console.log("Generated USERKEY file");
            return resolve();
          });

        } else {
          // Create user with admin role
          const initialUser = {
            username: process.env['USER_NAME'],
            passwordHash: bcrypt.hashSync(process.env['USER_PASSWORD'], appConfig.passwordSaltRounds),
          };
          models.User.create(initialUser).then(function (newUser) {
            newUser.addRole(createdRoles[0]).then(() => {
              return resolve();
            })
          })
        }
      })
    })
  });

module.exports = createInitialData;