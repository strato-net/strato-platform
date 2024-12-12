const express = require("express");
const { sendEmail } = require("../services/notifyService");
const { getEmailsByUsernames } = require("../services/subscriptionService");

const router = express.Router();

// Notify User
router.post("/notify", async (req, res) => {
  try {
    // Get method from query string
    const method = req.query.method ? req.query.method : "email"; // if no method specified, use email by default

    // Validate method
    if (!["email", "sms", "both"].includes(method)) {
      return res.status(400).send("Bad Request: Invalid method");
    }

    // Get usernames and message from body
    const { usernames, message } = req.body;

    if (!usernames || !message) {
      return res.status(400).send("Bad Request: Missing usernames or message");
    }

    // Get emails from db using usernames
    const emails = await getEmailsByUsernames(usernames);
    // const numbers = await getNumbersByUsernames(usernames);

    if (!emails.length) {
      return res
      .status(404)
      .send("Not Found: No users found with the given usernames");
    }

    // Prepare notification promises
    const notificationPromises = [];

    if (method === "email" || method === "both") {
      notificationPromises.push(sendEmail(emails, message));
    }

    // Uncomment the following block to enable SMS notifications
    // if (method === "sms" || method === "both") {
      //   notificationPromises.push(sendSMS(numbers, message));
      // }
      
      // Send notifications
      await Promise.all(notificationPromises);
      
    if (emails.length !== usernames.length){
      res.status(207).send("Did best effort, but unable to find the emails of " + (usernames.length - emails.length) + " of the users");
    } else {
      res.status(200).send("All notifications sent successfully");
    }
    
  } catch (error) {
    console.error("Error sending notifications:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;