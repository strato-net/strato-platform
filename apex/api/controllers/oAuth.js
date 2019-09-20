/* jshint esnext: true */

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const { getOrCreateKey } = require(`${process.cwd()}/lib/oAuth/oAuth`);

async function createUser(req, res, next) {
  const username = req.headers['x-user-unique-name'];

  if (!username) {
    let err = new Error("invalid param, expected username to be a non-empty string");
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  try {
    const user = await getOrCreateKey(username);
    res.status(200).json(user);
  } catch (error) {
    let err = new Error('could not create bloc account: ' + error);
    console.error(err);
    return next(err);
  }
}

module.exports = {
  createUser
};
