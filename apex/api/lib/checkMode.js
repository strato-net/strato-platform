const appConfig = require(`${process.cwd()}/config/app.config`);

module.exports =  {
  checkMode: function (req, res, next) {
    if (appConfig.SMD_MODE === 'public' || (process.env.OAUTH_ENABLED && process.env.OAUTH_ENABLED == appConfig.oAuthEnabledTrueValue)) {
      return next();
    }
    res.status(404).json({
      message: 'Not found'
    });
  }
}