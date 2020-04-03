// const request = require('request');
RouteParser = require('route-parser');

const appConfig = require('../config/app.config');
// const apiPatterns = require('../config/api-patterns');

/*
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
*/

module.exports = {
  _track: function (req, res) {
    res.status(200).send();

    // TODO: Obsolete, to be removed along with the other mixpanel mode configurations in apex config, STRATO docker-compose and strato-getting-started
    /*
    if (process.env['STRATO_GS_MODE'] === "1") return;

    // req.headers['x-original-method'] has "GET" or "POST";
    // req.headers['x-original-uri'] has "/bloc/v2.2/users" or whatever else is possible;
    // req.headers['x-real-ip'] should have end-user's IP (but has 172.18.0.1 because of a known docker issue https://github.com/moby/moby/issues/15086)


    // Pattern matching for api endpoints to prevent user path params from breaking the event grouping in mixpanel
    // E.g. `/cirrus/search/User?address=eq.c609a49b27188de4331cz94ef6d1125d80bd68e5` -> `/cirrus/search/:contract(?query)`
    const apiEndpoint = req.headers['x-original-uri']
      ? apiPatterns.find(pattern => !!(new RouteParser(pattern + '(/)')).match(req.headers['x-original-uri']))
      : req.headers['x-original-uri'];

    const eventName = (req.headers['x-original-method'] || apiEndpoint)
      ? `${req.headers['x-original-method']} ${apiEndpoint}`
      : 'unknown endpoint';

    // Not using mixpanel node library since it has ip=0 hardcoded and there's no way to track the ip.
    request(generateMixpanelUrl(eventName), function(err, r, b) {
      if (err) console.warn('error while trying to send track request to mixpanel: ', err)
    })
    */
  }
};
