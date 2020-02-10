import express from "express";
import helmet from "helmet";
import bodyParser from "body-parser";
import expressWinston from "express-winston";
import winston from "winston";
import constants from "./helpers/constants";
import cors from "cors";
import oauthHelper from "./helpers/oauthHelper"; 

import config from "./load.config";

import { fsUtil } from "blockapps-rest";
import { rest } from "blockapps-rest";
import { oauthUtil } from "blockapps-rest";


/////////////////////////////////////////////////////////////////////////
//                            OAuth 
////////////////////////////////////////////////////////////////////////

const oauthYaml = config.nodes[0].oauth;
const oauth = oauthUtil.init(oauthYaml);


const getApplicationCredentials = async (username) => {
  const accessToken = await oauth.getAccessTokenByClientSecret()
  const token = accessToken.token[config.nodes[0].oauth.tokenField ? config.nodes[0].oauth.tokenField : 'access_token']

  return { username, token }
}


// Contract source and deployment

const contractSource = `
  contract Test 
  { 
    int x = 0; 

    function inc() 
    { 
      x=x+1;
    }
  }
`;



(async () => {


  const { token } = await getApplicationCredentials('beans');
  const usObj = { token: token, username: 'dan', password: '1234' };

  console.log(`Your bearer token is: ${token}`);

  const { user } = await oauthHelper.createStratoUser(usObj);


  // Create contract
  const contractArgs = {
    name: "Test",
    source: contractSource,
    args: {},
    chainId: {},
    metadata: {"VM" : "SolidVM"}
  }
 
  const ctract = await rest.createContract(user, contractArgs, { config });
  
  // Call func
  const callArgs = {
    contract: {
      name: "Test",
      address: ctract.address
    },
    chainId: {},
    value: 0,
    method: "inc",
    args: {},
    metadata: {"VM" : "SolidVM"}
  };



  // TODO: send a bunch of concurrent calls to a Promise.all
//  let srch = await rest.search(user, { name : "Test", address : ctract.address }, { config });
  

//  let call = await rest.call(user, callArgs, { config });

//  const timeoot = new Promise((resolve, reject) => {
//    setTimeout(() => reject(new Error('timeout')), 5000);
//  });
  
/*  const call = await Promise.race([
    _call,
    timeoot
  ]).catch(function(err) {
    console.log(`${err}`);
  });
*/

  
  const callList = 
    [
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config }),
      rest.call(user, callArgs, { config })
    ];


  Promise.all(callList).then(function(results) {
    console.log(`${results}`);
  })
  .catch(function(err) {
    console.log(`${err}`);
  });


})();

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve(new Error('timeout'));
    }, timeout);
  });
}
