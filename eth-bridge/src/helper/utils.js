const axios = require("axios");

const sendEmail = async (baseUrl, notificationUrl, type, userName, token) => {

  const emailTemplates = {
    ethToEthstBridge: {
      subject: "Success! Your ETH Has Been Bridged to ETHST on STRATO!",
      content: `
        <h1>ETHST Bridged and ready to be Staked!</h1>
        <p>You've successfully bridged your ETH to ETHST, Mercata's wrapped ETH on the STRATO platform.</p>
        <p>This move unlocks a world of possibilities within our ecosystem, from exclusive DeFi opportunities to special marketplace perks.</p>
        <h2>What's Next?</h2>
        <ul>
          <li>Explore Mercata Marketplace to stake your ETHST on tokenized and get CATA!.</li>
          <li>Take advantage of exclusive events and offers within the STRATO ecosystem.</li>
        </ul>
        <a href="https://${baseUrl}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Explore Opportunities with ETHST</a>
        <p>Thank you for bridging your assets with us. Together, we're building a seamless and rewarding financial future.</p>
        <p>Best regards,<br>The Mercata Team</p>
      `,
    },
    // Add additional templates if necessary
  };

  // Send Email
  try {
    const { subject, content } = emailTemplates[type];

    const reqBody = {
      usernames: [userName],
      message: {
        subject,
        htmlContent: content
      }
    };

    const response = await axios.post(`${notificationUrl}/notify`, reqBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200 || response.status === 201) {
      console.log("Email sent successfully to ", userName);
    }

  } catch (error) {
    console.log("Failed to send email to ", userName);
    console.log("error", error);
  }
};

const getUserName = async (baseUrl, address, token) => {
  try {
    const res = await axios.get(
      `https://${baseUrl}/cirrus/search/Certificate?userAddress=eq.${address}`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );
  
    return res.data[0].commonName;
  } catch (error) {
    console.log("error", error);
  }
};

module.exports = {
  sendEmail, getUserName
};