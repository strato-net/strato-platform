const fs = require('fs');
const multer  = require('multer');
const path = require('path');

module.exports = {
  upload: function (req, res, next) {
    const upload = multer(
      {
        dest: 'uploads/',
        fileFilter: function (req, file, cb) {
          const filetypes = /zip/;
          const mimetype = filetypes.test(file.mimetype);
          const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

          // TODO: validate mimetype by file content

          if (mimetype && extname) {
            return cb(null, true);
          }
          cb("Error: File upload only supports the following filetypes: " + filetypes);
        },
      }
    );

    upload.single('file')(req, res, function (errorMessage) {
      if (errorMessage) {
        let err = new Error(errorMessage);
        err.status = 400;
        return next(err);
      }

      const username = req.body.username;
      const password = req.body.password;
      const file = req.file;

      if (!username || !password || !file) {
        let err = new Error("wrong params, expected: {username, password, file}");
        err.status = 400;
        return next(err);
      }

      // TODO: unpack files to tmp/
      // todo: use adm-zip package - already installed
      // TODO: check if all contracts from tmp/contracts/ are compile
      // TODO: register dapp on blockchain (upload contract with username/password provided)
      // TODO: move app from tmp/ to app/


    })
  },
};