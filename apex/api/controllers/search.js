/* jshint esnext: true */

const winston = require('winston-color')
const moment = require('moment')

// Temporary endpoint that logs the search query and time that it was sent
async function search(req, res, next) {
  try {
    const { q } = req.query
    const now = moment.utc()
    winston.info(JSON.stringify({
      searchQuery: q,
      timestamp: now.unix(),
    }))
    res.status(200).json({query: q});
  } catch (error) {
    let err = new Error('could not perform search: ' + error);
    console.error(err);
    return next(err);
  }
}

module.exports = {
  search
};
