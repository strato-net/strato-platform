const co = require('co');
const sequelize = require('sequelize');
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;

const models = require('../models');
const appConfig = require('../config/app.config');

module.exports = {
  fetchEntities: function (req, res, next) {
    co(function* () {
      try {
        const entities = yield models.Entity.findAll({
          attributes: ['id', 'name', 'status', [sequelize.fn('COUNT', sequelize.col('Users')), 'usersCount']],
          include: [{
            model: models.EntityUser,
            as: 'Users',
            attributes: []
          }],
          group: ['Entity.id']
        });
        res.status(200).json(entities);
      } catch (error) {
        let err = new Error('could not fetch entities: ', error);
        err.status = 500;
        return next(err);
      }
    })
  },
  fetchEntity: function (req, res, next) {
    co(function* () {
      try {
        const entity = yield models.Entity.find({
          attributes: ['name'],
          where: { id: req.params.id },
          include: [{
            model: models.EntityUser,
            as: 'Users',
            include: [{
              model: models.User
            }]
          }]
        });
        if (!entity) {
          let err = new Error('Not found.');
          err.status = 404;
          return next(err);
        }
        res.status(200).json(entity);
      } catch (error) {
        console.log(error)
        let err = new Error('could not fetch entity: ', error);
        err.status = 500;
        return next(err);
      }
    })
  },
  createEntity: function (req, res, next) {
    co(function* () {
      if (!req.body.name || !req.body.enodeUrl || !req.body.adminName || !req.body.adminEmail
        || !req.body.adminEthereumAddress) {
        let err = new Error("wrong params");
        err.status = 400;
        return next(err);
      }

      let user, newEntity;
      try {
        user = yield models.User.findOne({
          // where: { accountAddress: req.body.adminEthereumAddress, username: req.body.adminName }
          where: { username: req.body.adminName }
        });
      } catch (error) {
        let err = new Error('could not create entity: ', error);
        err.status = 500;
        return next(err);
      }

      const password = '1234';
      try {
        if (!user) {
          user = yield models.User.create({
            username: req.body.adminName,
            passwordHash: bcrypt.hashSync(password, appConfig.passwordSaltRounds),
          });
        }
      } catch (error) {
        let err = new Error('could not create entity: ', error);
        err.status = 500;
        return next(err);
      }

      // Create blockchain user in bloc
      let blocUser;
      try {
        blocUser = yield blockappsRest.createUser(req.body.adminName, password, true);
        // Set the account address to user in db
        user.accountAddress = blocUser.address;
        yield user.save({ fields: ['accountAddress'] });
      } catch (blocError) {
        user.destroy();
        let err = new Error('could not create entity:', blocError);
        err.status = 500;
        return next(err);
      }

      try {
        newEntity = yield models.Entity.create({
          name: req.body.name,
          enodeUrl: req.body.enodeUrl,
          status: req.body.status || undefined
        });
      } catch (error) {
        let err;
        if (error.name === "SequelizeUniqueConstraintError") {
          err = new Error("Entity already exists");
          err.status = 409;
          return next(err);
        }
        err = new Error('could not create entity: ', error);
        err.status = 500;
        return next(err);
      }

      try {
        const entityId = newEntity.id;
        const admin = {
          email: req.body.adminEmail,
          EntityId: entityId,
          admin: true,
          UserId: user.id
        };
        const newEntityAdmin = yield models.EntityUser.create(admin);
      } catch (error) {
        newEntity.destroy();
        let err;
        if (error.name === "SequelizeUniqueConstraintError") {
          err = new Error("Email already exists");
          err.status = 409;
          return next(err);
        }
        err = new Error('could not create entity: ', error);
        err.status = 500;
        return next(err);
      }
      res.status(200).json({ success: true });
    })
  },
  voteEntity: function (req, res, next) {
    co(function* () {
      if (!req.body.username || !req.body.password || !req.body.voteType
        || (req.body.voteType !== 'agree' && req.body.voteType !== 'disagree')) {
        let err = new Error("wrong params");
        err.status = 400;
        return next(err);
      }
      let entity;
      try {
        entity = yield models.Entity.findOne({ where: { id: req.params.id } })
      } catch (error) {
        let err = new Error('could not add vote: ', error);
        err.status = 500;
        return next(err);
      }

      if (!entity) {
        let err = new Error('Not found.');
        err.status = 404;
        return next(err);
      }

      try {
        const authErrorText = "user does not exist or wrong user-password pair provided";
        // const voter = yield models.User.findOne({ where: { username: req.body.username } });
        const voter = yield models.EntityUser.findOne({
          include: [{
            model: models.User,
            where: { username: req.body.username }
          }],
          attributes: []
        })
        if (!voter) {
          let err = new Error(authErrorText);
          err.status = 401;
          return next(err);
        }
        const passIsCorrect = yield bcrypt.compare(req.body.password, voter.User.passwordHash);
        if (!passIsCorrect) {
          let err2 = new Error(authErrorText);
          err2.status = 401;
          return next(err2);
        } else {
          const agree = (req.body.voteType === 'agree');
          let numberOfVotes = yield models.EntityVote.count({
            where: { EntityUserId: req.params.id, agree }
          });
          // Add the vote to the existing vote count
          numberOfVotes = numberOfVotes + 1;
          let totalMembers = yield models.Entity.count({
            where: { status: 'Member' }
          });
          // Exclude the chosen entity if it is a Member
          if (entity.status !== 'Pending')
            totalMembers = totalMembers - 1;
          console.log(totalMembers)
          console.log(numberOfVotes)
          if (numberOfVotes / totalMembers > 0.6) {
            if ((entity.status === 'Pending' && agree)
              || (entity.status === 'Removal Requested' && !agree)) {
              yield entity.update({ status: 'Member' });
            } else if ((entity.status === 'Pending' && !agree)
              || (entity.status === 'Removal Requested' && agree)) {
              yield entity.destroy();
            }
            models.EntityVote.destroy({ where: { EntityUserId: entity.id } });
            res.status(200).json({ success: true })
          } else {
            if (numberOfVotes === 1 && entity.status === 'Member')
              yield entity.update({ status: 'Removal Requested' });
            const vote = yield models.EntityVote.create({
              agree,
              UserId: voter.user.id,
              EntityUserId: entity.id
            });
            res.status(200).json({ success: true })
          }
        }
      } catch (error) {
        console.log(error)
        let err = new Error('could not add vote: ', error);
        err.status = 500;
        return next(err);
      }
    })
  }
}