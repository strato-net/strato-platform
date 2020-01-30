// TODO: we don't need this. @nikita please have a look and confirm
const randToken = require('rand-token');

const models = require('../models');


module.exports = {
  create: function (req, res, next) {
    const name = req.body.name;

    if (!name) {
      let err = new Error("wrong params, expected: {name}");
      err.status = 400;
      return next(err);
    }

    models.Token.create({
      UserId: req.user.id,
      name: name,
      // TODO: add the part of hashed name as a prefix to token (to be able to find out the name by token) - see sendgrid tokens list as an example
      token: randToken.generate(64),
    }).then(token => {
        res.status(200).json({token: token});
      }
    ).catch(error => {
      if (error.name === "SequelizeUniqueConstraintError") {
        let err = new Error("user already has the token with name provided");
        err.status = 409;
        return next(err);
      }
      console.error(error);
    });
  },

  list: function (req, res, next) {
    models.Token.findAll({
      where: {
        UserId: req.user.id
      },
      order: [
        ['createdAt', 'ASC'],
      ]
    }).then(tokens => {
      tokens = tokens.map(token => token.toJson());
      res.status(200).json({tokens: tokens});
    }).catch(err => next(err));
  },

  revoke: function(req, res, next) {
    const id = req.body.id;
    if (!id) {
      let err = new Error("wrong params, expected: {id}");
      err.status = 400;
      return next(err);
    }
    models.Token.destroy(
      {
        where: {
          UserId: req.user.id,
          id: id,
        }
      }
    ).then(removedCount => {
        if (!removedCount) {
          let err = new Error("token was not found with parameters provided");
          err.status = 404;
          return next(err);
        }
        res.status(200).json({message: 'token revoked'});
      }
    ).catch(err => next(err));
  }
};