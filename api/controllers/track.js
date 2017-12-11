const request = require('request');

const appConfig = require('../config/app.config');

const generateMixpanelUrl = function(event) {
  const data = new Buffer(JSON.stringify(
    {
      "event": event,
      "properties": {
        "token": appConfig.mixpanel.token,
      }
    }
  )).toString('base64');
  return `http://api.mixpanel.com/track/?data=${data}&ip=1`;
};

module.exports = {
  _track: function (req, res) {
    res.status(200).send();
    // req.headers['x-original-method'] has "GET" or "POST";
    // req.headers['x-original-uri'] has "/bloc/v2.2/users" or whatever else is possible;
    // req.headers['x-real-ip'] should have end-user's IP (but has 172.18.0.1 because of a known docker issue https://github.com/moby/moby/issues/15086)

    // Not using mixpanel node library since it has ip=0 hardcoded and there's no way to track the ip.
    request(generateMixpanelUrl(`${req.headers['x-original-method']} ${req.headers['x-original-uri']}`), function(err, r, b) {
      if (err) console.warn('error while trying to send track request to mixpanel: ', err)
    })
  }
};
