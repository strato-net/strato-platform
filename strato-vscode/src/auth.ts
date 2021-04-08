import { oauthUtil } from 'blockapps-rest';
import getConfig from './load.config';
var axios = require('axios');
var qs = require('qs');
var data = qs.stringify({
 'grant_type': 'client_credentials' 
});


function useFormURLEncode(value) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function getBasicHeader(clientId, clientSecret) {
  const encodedCredentials = `${useFormURLEncode(clientId)}:${useFormURLEncode(clientSecret)}`;
  const auth = Buffer.from(encodedCredentials).toString('base64');
  return `Basic ${auth}`
}

export async function getApplicationUser(mNodeId?: number): Promise<any> {
  const config = getConfig() || {}
  const options = { config };
  const nodes = config.nodes || []
  if (nodes.length === 0) {
    return undefined
  }
  const nodeId = mNodeId || 0
  const nodeOauth = nodes[nodeId].oauth
  const oauth = oauthUtil.init(nodeOauth)
  const { applicationUserName = 'APP_USER' } = config
  // const { clientId, clientSecret, scope } = oauth
  try {
    var req = {
      method: 'post',
      url: oauth.openIdConfig.token_endpoint,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Authorization': getBasicHeader(nodeOauth.clientId, nodeOauth.clientSecret)
      },
      data : data
    };
    const res = await axios(req)
    const appUser = {
      name: applicationUserName,
      token: res.data.access_token
    }
    return appUser
  } catch(e) {
    console.log(e)
    return undefined
  }
}