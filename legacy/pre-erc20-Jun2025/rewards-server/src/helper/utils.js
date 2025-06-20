const axios = require("axios");

const sendEmail = async (baseUrl, notificationUrl, type, userName, token) => {

  const emailTemplates = {
    firstPurchase: {
      subject: "Big Win! You've Earned 4% Back in USDST!",
      content: `
        <h1>Congratulations! You've made your first move and it's already paying off.</h1>
        <p>For your first purchase on Mercata Marketplace, we've added 4% of the value back into your account in USDST. These are your winnings, ready to be redeemed for exclusive items, special offers, and more.</p>
        <h2>What's Next?</h2>
        <ul>
          <li>Keep playing and keep winning – every purchase earns you more USDST.</li>
          <li>Redeem your USDST for high-roller rewards or save them for a bigger payout!</li>
        </ul>
        <p>Need something special? <strong>Ask the Mercata team to source an item you can't quite find or don't have the time to buy.</strong> We're here to help you get exactly what you're looking for.</p>
        <a href="https://${baseUrl}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Play On – Explore More Offers</a>
        <p>Thanks for making your first purchase with us. We're here to make sure every move is a winning one.</p>
        <p>Best Regards,<br>The Mercata Team</p>
      `,
    },
    additionalPurchase: {
      subject: "Your Purchase Earned You More USDST – Keep Winning!",
      content: `
        <h1>The cards are in your favor!</h1>
        <p>With your latest purchase, you've just stacked up even more USDST.</p>
        <p>We've credited your account with 2% of your purchase value in USDST. Every purchase on Mercata Marketplace gets you closer to those exclusive rewards and perks.</p>
        <p>Every time you buy, you're earning more USDST, bringing you closer to those high-roller rewards.</p>
        <a href="https://${baseUrl}" style="display: inline-block; width: 100%; max-width: 250px; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; text-align: center; box-sizing: border-box;">Check Your Winnings – View USDST Balance</a>
        <p>Thanks for continuing to shop with Mercata. The next big win is just around the corner!</p>
        <p>Wishing you luck,<br>The Mercata Team</p>
      `,
    },
    sellerReward: {
      subject: "🎉 You've Earned 1% Back in USDST for Your Sale!",
      content: `
        <h1>Congratulations, you've made a successful sale on Mercata Marketplace!</h1>
        <p>As a reward, we've credited your account with 1% of the sale value in USDST. These points are our way of saying thanks for being an active part of the Mercata community.</p>
        <h2>What Can You Do with USDST?</h2>
        <ul>
          <li>Redeem them for exclusive rewards and special offers.</li>
          <li>Save them up for even bigger rewards down the line.</li>
          <li>Use your USDST to enhance your standing in the Mercata ecosystem.</li>
        </ul>
        <p>Keep up the great work, and remember, every sale brings you closer to more rewards. If you need something special to list or are looking for a particular item to sell, just let us know. <strong>We're here to help you source what you need.</strong></p>
        <a href="https://${baseUrl}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">View Your USDST Balance</a>
        <p>Thanks for being a valued member of the Mercata community. We look forward to seeing your next big sale!</p>
        <p>Best regards,<br>The Mercata Team</p>
      `,
    },
    newRegistration: {
      subject: "Jackpot! You've Just Scored 100 USDST on Mercata!",
      content: `
        <h1>Welcome to the Mercata VIP Lounge!</h1>
        <p>You've hit the jackpot just by joining us! To kickstart your journey, we've credited your account with 100 USDST. Consider it your welcome bonus for stepping into the Mercata Marketplace.</p>
        <h2>What Are USDST?</h2>
        <ul>
          <li>They're your golden chips, ready to be cashed in for exclusive assets, VIP-only promotions, and more.</li>
        </ul>
        <p>Ready to roll the dice and see what you can win? Log in now and start stacking those USDST!</p>
        <a href="https://${baseUrl}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Example and Start Shopping</a>
        <p>Thank you for joining us. The action is just getting started!</p>
        <p>Best,<br>The Mercata Marketplace Team</p>
      `,
    },
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

}

module.exports = {
  sendEmail, getUserName
};
