const express = require("express");
const {} = require("../services/notifyService");

const router = express.Router();

// Notify User
router.post("/notify", async (req, res) => {
    // Get method from query string
    // Get usernames and message from body
    // Get emails from db using usernames
    // Send email to users
});
