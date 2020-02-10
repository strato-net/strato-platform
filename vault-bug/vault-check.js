const barest = require('blockapps-rest')
var request = require('request');


// below is copied code from other files to get out of using babel-node
const config = barest.fsUtil.getYaml(
  process.env.SERVER
    ? `config/${process.env.SERVER}.config.yaml`
    : `${process.env.CONFIG_DIR_PATH || '.'}/config.yaml`,
)

const oauth = barest.oauthUtil.init(config.nodes[0].oauth)

const getApplicationCredentials = async (username) => {
  const accessToken = await oauth.getAccessTokenByClientSecret()
  const token = accessToken.token[config.nodes[0].oauth.tokenField ? config.nodes[0].oauth.tokenField : 'access_token']

  return { username, token }
}



// gets a token and pings getKey, logs timeouts
(async () => {
  const { token } = await getApplicationCredentials('beans');

  var options = {
    'method': 'GET',
    'url': 'http://localhost:8080/strato/v2.3/key',
    'headers': {
      'Authorization': `Bearer ${token}`
    },
    'timeout' : 10000 // 10 seconds
  };
 
  request(options, function (error, response) {
    if (error) {
      if (error.code === 'ETIMEDOUT') 
        console.log("timeout");
      else
        throw new Error(error); //TODO: maybe we want some other behavior
    }
    else
      console.log("success");
  });

})();


