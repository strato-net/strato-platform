import { oauthUtil } from 'blockapps-rest';
import * as vscode from 'vscode';
import getConfig from './load.config';
var axios = require('axios');

function useFormURLEncode(value) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

export function getBasicHeader(clientId, clientSecret) {
  const encodedCredentials = `${useFormURLEncode(clientId)}:${useFormURLEncode(clientSecret)}`;
  const auth = Buffer.from(encodedCredentials).toString('base64');
  return `Basic ${auth}`
}

export async function applicationUserLogin(context: vscode.ExtensionContext, username: string, password: string): Promise<any> {
  try {
    const config = getConfig() || {}
    const nodes = config.nodes || []
    if (nodes.length === 0) {
      return undefined
    }
    const activeNode: number = vscode.workspace.getConfiguration().get('strato-vscode.activeNode') || 0
    const nodeOauth = nodes[activeNode].oauth
    const oauth = await oauthUtil.init(nodeOauth)
    const req = {
      method: 'post',
      url: oauth.openIdConfig.token_endpoint,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Authorization': getBasicHeader(nodeOauth.clientId, nodeOauth.clientSecret)
      },
      data: `grant_type=password&username=${username}&password=${password}`
    };

    const res = await axios(req) 
    context.secrets.delete('access_token_data')
    context.secrets.store('access_token_data', JSON.stringify({
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
    })).then(() => {
      vscode.window.showInformationMessage(`Successfully logged in as ${username}`)
      console.debug('Access token data has been stored in context.secrets')
    })
  } catch(e: any) {
    e.code === 'ERR_BAD_REQUEST' ? 
      vscode.window.showErrorMessage('Login failed - invalid username or password.') :
      vscode.window.showErrorMessage(`Error: ${e}`)
    return undefined
  }
}

export async function getApplicationUser(mNodeId?: number, tokens?: any): Promise<any> {
  try {
    const config = getConfig() || {}
    const nodes = config.nodes || []
    if (nodes.length === 0) {
      return undefined
    }
    const nodeId: number = mNodeId || vscode.workspace.getConfiguration().get('strato-vscode.activeNode') || 0
    const nodeOauth = nodes[nodeId].oauth
    const oauth = await oauthUtil.init(nodeOauth)

    if (tokens) {
      if (!oauth.isTokenExpired(tokens.access_token)) {
        return { token: tokens.access_token }
      } else if (!oauth.isTokenExpired(tokens.refresh_token)) {
        const req = {
          method: 'post',
          url: oauth.openIdConfig.token_endpoint,
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded', 
            'Authorization': getBasicHeader(nodeOauth.clientId, nodeOauth.clientSecret)
          },
          data: `grant_type=refresh_token&refresh_token=${tokens.refresh_token}`
        };
        const res = await axios(req)
        return { token: res.data.access_token, refresh_token: res.data.refresh_token }
      }

      vscode.window.showWarningMessage('User access tokens have expired. Please login again.')
      return undefined
    }

    const req = {
      method: 'post',
      url: oauth.openIdConfig.token_endpoint,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Authorization': getBasicHeader(nodeOauth.clientId, nodeOauth.clientSecret)
      },
      data: 'grant_type=client_credentials'
    };
    const res = await axios(req)
    return { token: res.data.access_token, refresh_token: '' }
  } catch(e) {
    vscode.window.showErrorMessage(`Error: ${e}`)
    return undefined
  }
}
