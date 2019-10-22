/* jshint esnext: true */
const querystring = require('querystring');
const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);


async function createKey(username, userParams = null) {

    if (!username) {
      let err = new Error("invalid param, expected username to be a non-empty string");
      err.status = RestStatus.BAD_REQUEST;
      throw err;
    }
    
    // Create blockchain user
    try {

      userParams = userParams == null ? {} : userParams;
      const userAccount = await ax.post(process.env.vaultWrapperHttpHost, userParams, '/strato/v2.3/key', {
        "x-user-unique-name": username,
      });

      //faucet user so they can do stuff
      await waitFaucet(userAccount.address);

      return {
        status: RestStatus.OK,
        user: userAccount
      };
    } catch (blocError) {
      let err = new Error('could not create bloc account: ' + blocError); //fixme - see universalError in ht3
      console.error(err);
      throw err;
    }
}

async function getKey(username, userQuery = null) {

  if (!username) {
    let err = new Error("invalid param, expected username to be a non-empty string");
    err.status = RestStatus.BAD_REQUEST;
    throw err;
  }

  try {
    const query = userQuery ? `?${querystring.stringify(userQuery)}` : '';

    const userAccount = await ax.get(process.env.vaultWrapperHttpHost, `/strato/v2.3/key${query}`, {
      "x-user-unique-name": username,
    });

    return {
      status: RestStatus.OK,
      user: userAccount
    };
  } catch (blocError) {
    let err = new Error('could not find bloc account: ' + blocError); //fixme - see universalError in ht3
    throw err
  }

}

async function getOrCreateKey(userUniqueName, userQuery = null){
  try {
    return await getKey(userUniqueName, userQuery)
  } catch (err) {
    return await createKey(userUniqueName, userQuery)
  }
}



//===================
// Helper functions
//===================

async function waitFaucet(address) { //fixme - function duplicated in multiple tests, move to util file
  const params = {
    address: address
  }

  //faucet
  await ax.postue(process.env.stratoRoot, params, '/faucet')
  
  //wait for update
  const sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  };

  let res = [];
  do {
    await sleep(400);
    const query = `?${querystring.stringify(params)}`;

    res = await ax.get(process.env.stratoRoot, `/account${query}`)

  } while (res.length < 1);

}


//===================


module.exports = {
  createKey,
  getKey,
  getOrCreateKey
};
