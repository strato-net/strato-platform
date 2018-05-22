const appConfig = require('../config/app.config');
module.exports =  {
  checkMode: function (req, res, next) {
    if (appConfig.SMD_MODE === 'public') {
      return next();
    }
    res.status(404).json({
      message: 'Not found'
    });
  }
}