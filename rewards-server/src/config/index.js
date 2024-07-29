// src/config/env.js
require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  clientSecret: process.env.CLIENT_SECRET,
  NODE: process.env.NODE,
  prodStratsAddress: "b220195543f652f735b7847c4af399d0323e1ff6",
  testnetStratsAddress: "488cd3909d94606051e0684cf6caa5763fb78613",
};
