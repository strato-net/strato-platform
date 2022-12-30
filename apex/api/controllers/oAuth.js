/* jshint esnext: true */

const jwt_decode = require('jwt-decode');


const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const { getOrCreateKey } = require(`${process.cwd()}/lib/oAuth/oAuth`);

async function createUserKey(req, res, next) {

  const accessToken = req.headers['x-user-access-token'];


  if (!accessToken) {
    let err = new Error("invalid param, expected value in x-user-access-token header");
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }
  
  const token_payload = jwt_decode(accessToken)
  const username = token_payload['preferred_username'] || token_payload['email'] || token_payload['sub'] || 'Logged in user'
  
  try {
    const response = await getOrCreateKey(accessToken);
    const userKeyData = Object.assign({}, response.user, { username: username });

    res.status(200).json(userKeyData);
  } catch (error) {
    let err = new Error('could not create bloc account: ' + error);
    console.error(err);
    return next(err);
  }
}

module.exports = {
  createUserKey
};
