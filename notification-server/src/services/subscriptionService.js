const client = require("../db");

// Check if the user is already subscribed
const isSubscribed = async (username) => {
  try {
    const result = await client.query(
      "SELECT * FROM contact_info WHERE username = $1",
      [username]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error("Error checking subscription status:", error);
    throw error; // Re-throw the error to be handled by the caller if needed
  }
};

// Subscribe a user to the notification service
const subscribe = async (username, email) => {
  try {
    await client.query(
      "INSERT INTO contact_info (username, email) VALUES ($1, $2)",
      [username, email]
    );
    return true;
  } catch (error) {
    if (error.code === "23505") {
      // Duplicate entry error code in PostgreSQL
      console.error(`User ${username} is already subscribed.`, error);
    } else {
      console.error("Error subscribing user:", error);
    }
    return false;
  }
};

// Get emails by usernames
const getEmailsByUsernames = async (usernames) => {
  try {
    const result = await client.query(
      "SELECT email FROM contact_info WHERE username = ANY($1::text[])",
      [usernames]
    );
    return result.rows.map((row) => row.email);
  } catch (error) {
    console.error("Error retrieving emails by usernames:", error);
    throw error; // Re-throw the error to be handled by the caller if needed
  }
};

module.exports = {
  isSubscribed,
  subscribe,
  getEmailsByUsernames,
};
