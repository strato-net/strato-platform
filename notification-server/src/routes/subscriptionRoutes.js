const express = require('express');
const { isSubscribed, subscribe } = require('../services/subscriptionService');
const router = express.Router();

// Save user email
router.put('/subscribe', async (req, res) => {
  try {
    // email will be inside the authorization header
    // username will be inside the body
    const email = req.headers.authorization;
    const { username } = req.body;

    // Validate email and username
    if (!email || !username) {
      return res.status(400).send('Bad Request: Missing email or username');
    }

    // Check if the user is already subscribed
    const subscribed = await isSubscribed(username);

    if (subscribed) {
      return res.status(200).send('User is already subscribed');
    }

    // Subscribe the user
    const success = await subscribe(username, email);

    if (success) {
      return res.status(201).send('User subscribed successfully');
    }

    return res.status(500).send('Internal Server Error: Error subscribing user');
  } catch (error) {
    console.error('Error processing subscription:', error);
    return res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
