const s3 = require('./s3');

function upload(params) {
  return new Promise((resolve, reject) => {
    s3.upload(params, function (err, data) {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    })
  })
}

module.exports = {
  upload
};