/* jshint esnext: true */

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const { getOrCreateKey } = require(`${process.cwd()}/lib/oAuth/oAuth`);

async function createUserKey(req, res, next) {
  const accessToken = req.headers['x-user-access-token'];

  if (!accessToken) {
    let err = new Error("invalid param, expected username to be a non-empty string");
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  try {
    const response = await getOrCreateKey(accessToken);
    // TODO: Critical: return the actual username coming from VaultProxy instead #fix-before-shared-vault-done
    const userKeyData = Object.assign({}, response.user, { username: '#todo-in-apex-#fix-before-shared-vault-done' });

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
