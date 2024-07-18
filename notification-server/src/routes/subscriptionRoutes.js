const express = require("express");
const {} = require("../services/subscriptionService");
const router = express.Router();

// Save user email
router.put("/subscribe", async (req, res) => {
    // first check db for existing email
    // if email exists, return 200
    // if email doesn't exist, save email to db and return 201
    // email will be inside the authorization header
    // username will be inside the body
});
