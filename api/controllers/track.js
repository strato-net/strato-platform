const appConfig = require('../config/app.config');


module.exports = {
  _track: function (req, res, next) {
    console.log(req);
    res.status(200).send();
    console.log('responded');
  }
};
