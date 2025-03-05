const express = require('express');
const { isSubscribed, subscribe } = require('../services/subscriptionService');
const router = express.Router();
const { jwtDecode } = require('jwt-decode');

const target_realm = process.env.KEYCLOAK_USER_REALM;
let KcAdminClient;

(async () => {
  try {
      const module = await import('@keycloak/keycloak-admin-client');
      KcAdminClient = module.default;
  } catch (error) {
      console.error("Failed to initialize Keycloak client:", error);
  }
})();

// Authenticate with Keycloak using client credentials
async function authenticateKeycloak(kcAdminClient) {
  try {
      await kcAdminClient.auth({
          clientId: process.env.MASTER_REALM_CLIENT_ID,
          clientSecret: process.env.MASTER_REALM_CLIENT_SECRET,
          grantType: 'client_credentials',
      });
  } catch (error) {
      console.error("Failed to authenticate with Keycloak:", error);
      throw new Error("Keycloak authentication failed");
  }
}

async function getKeycloakUserAttributes(username, realm) {
  try {
      if (!KcAdminClient) {
          throw new Error('Keycloak Admin Client is not initialized yet');
      }

      const kcAdminClient = new KcAdminClient({
          baseUrl: process.env.KEYCLOAK_AUTH_URL,
          realmName: 'master',
      });

      await authenticateKeycloak(kcAdminClient);

      const users = await kcAdminClient.users.find({ realm, username });

      if (users.length === 0) {
          console.warn(`User '${username}' not found in realm '${realm}'. Proceeding with null attributes.`);
          return { telegramUsername: null, referrerUsername: null };
      }

      const user = users[0];
      const attributes = user.attributes || {};

      // Extract values and handle empty strings
      const telegramUsername = attributes['telegram-username']?.[0] || null;
      const referrerUsername = attributes['referrer-username']?.[0] || null;

      return {
          telegramUsername: telegramUsername === '' ? null : telegramUsername,
          referrerUsername: referrerUsername === '' ? null : referrerUsername,
      };
  } catch (error) {
      console.error(`Keycloak API Error for user '${username}':`, error);
      return { telegramUsername: null, referrerUsername: null }; // Default to null if Keycloak fails
  }
}


// Save user email
router.put('/subscribe', async (req, res) => {
  try {
    // email will be inside the authorization header
    // username will be inside the body
    const token = req.headers.authorization ? req.headers.authorization : req.headers['x-user-access-token'];
    const decodedToken = jwtDecode(token);
    const { username } = req.body;
    const email = decodedToken.email;


    if (!token) {
      return res.status(401).json({ error: 'Authorization token missing' });
    }

    // respond with text/plain content-type
    res.type('txt');

    // Validate email and username
    if (!email || !username) {
      return res.status(400).send('Bad Request: Missing email or username');
    }

    // Fetch Keycloak User Attributes
    const { telegramUsername, referrerUsername } = await getKeycloakUserAttributes(username, target_realm);

    // Check if the user is already subscribed
    const subscribed = await isSubscribed(username);

    if (subscribed) {
      return res.status(200).send('User is already subscribed');
    }

    // Subscribe the user
    const success = await subscribe(username, email, telegramUsername, referrerUsername);

    if (success) {
      return res.status(200).send('User subscribed successfully');
    }

    return res.status(500).send('Internal Server Error: Error subscribing user');
  } catch (error) {
    console.error('Error processing subscription:', error);
    return res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
