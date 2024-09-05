import { rest } from "blockapps-rest";
import config from "../../../load.config";
import sendEmail from "../../../helpers/email";
const axios = require("axios");

const sendMail = async (email, subject, contents, authorizationHeader) => {

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer')) {
    console.log("Unauthorized: Missing or invalid token");
  }

  const token = authorizationHeader.split(' ')[1];

  const reqBody = {
    usernames: [email],
    message: {
      subject,
      htmlContent: contents
    }
  };

  try {
    const mailRes = await axios.post(
      `${process.env.NOTIFICATION_SERVER_URL}/notify`,
      reqBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    console.log("mailRes", mailRes);
    return mailRes;
  } catch (error) {
    console.log("error", error);
  }
  

}
class NotificationController {

  static async sendNewRegistrationEmail(req, res, next) {
    try {
      const { body: { user } } = req;
      const authorizationHeader = req.headers.authorization;

      const subject = "Jackpot! You've Just Scored 100 STRATS on Mercata!";
      const contents = `
        <h1>Welcome to the Mercata VIP Lounge!</h1>
        <p>You've hit the jackpot just by joining us! To kickstart your journey, we've credited your account with 100 STRATS. Consider it your welcome bonus for stepping into the Mercata Marketplace.</p>
        <h2>What Are STRATS?</h2>
        <ul>
          <li>They're your golden chips, ready to be cashed in for exclusive assets, VIP-only promotions and more.</li>
        </ul>
        <p>Ready to roll the dice and see what you can win? Log in now and start stacking those STRATS!</p>
        <a href="${config.serverHost}/shop" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Example and Start Shopping</a>
        <p>Thank you for joining us. The action is just getting started!</p>
        <p>Best,<br>The Mercata Marketplace Team</p>
      `;

      await sendMail(user, subject, contents, authorizationHeader)
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async sendFirstPurchaseEmail(req, res, next) {
    try {
      const { body: { user } } = req;
      const authorizationHeader = req.headers.authorization;

      const subject = "Big Win! You've Earned 4% Back in STRATS!";
      const contents = `
        <h1>Congratulations! You've made your first move and it's already paying off.</h1>
        <p>For your first purchase on Mercata Marketplace, we've added 4% of the value back into your account in STRATS. These are your winnings, ready to be redeemed for exclusive items, special offers, and more.</p>
        <h2>What's Next?</h2>
        <ul>
          <li>Keep playing and keep winning – every purchase earns you more STRATS.</li>
          <li>Redeem your STRATS for high-roller rewards or save them for a bigger payout!</li>
        </ul>
        <p>Need something special? <strong>Ask the Mercata team to source an item you can't quite find or don't have the time to buy.</strong> We're here to help you get exactly what you're looking for.</p>
        <a href="${config.serverHost}/offers" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Play On – Explore More Offers</a>
        <p>Thanks for making your first purchase with us. We're here to make sure every move is a winning one.</p>
        <p>Best Regards,<br>The Mercata Team</p>
      `;

      await sendMail(user, subject, contents, authorizationHeader)
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async sendAdditionalPurchaseEmail(req, res, next) {
    try {
      const { body: { user } } = req;
      const authorizationHeader = req.headers.authorization;

      const subject = "Your Purchase Earned You More STRATS – Keep Winning!";
      const contents = `
        <h1>The cards are in your favor!</h1>
        <p>With your latest purchase, you've just stacked up even more STRATS.</p>
        <p>We've credited your account with 2% of your purchase value in STRATS. Every purchase on Mercata Marketplace gets you closer to those exclusive rewards and perks.</p>
        <p>Every time you buy, you're earning more STRATS, bringing you closer to those high-roller rewards.</p>
        <a href="${config.serverHost}/balance" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">Check Your Winnings – View STRATS Balance</a>
        <p>Thanks for continuing to shop with Mercata. The next big win is just around the corner!</p>
        <p>Wishing you luck,<br>The Mercata Team</p>
      `;

      await sendMail(user, subject, contents, authorizationHeader)
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async sendSellerRewardEmail(req, res, next) {
    try {
      const { body: { user } } = req;
      const authorizationHeader = req.headers.authorization;

      const subject = "🎉 You've Earned 1% Back in STRATS for Your Sale!";
      const contents = `
        <h1>Congratulations, you've made a successful sale on Mercata Marketplace!</h1>
        <p>As a reward, we've credited your account with 1% of the sale value in STRATS. These points are our way of saying thanks for being an active part of the Mercata community.</p>
        <h2>What Can You Do with STRATS?</h2>
        <ul>
          <li>Redeem them for exclusive rewards and special offers.</li>
          <li>Save them up for even bigger rewards down the line.</li>
          <li>Use your STRATS to enhance your standing in the Mercata ecosystem.</li>
        </ul>
        <p>Keep up the great work, and remember, every sale brings you closer to more rewards. If you need something special to list or are looking for a particular item to sell, just let us know. <strong>We're here to help you source what you need.</strong></p>
        <a href="${config.serverHost}/balance" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none;">View Your STRATS Balance</a>
        <p>Thanks for being a valued member of the Mercata community. We look forward to seeing your next big sale!</p>
        <p>Best regards,<br>The Mercata Team</p>
      `;

      await sendMail(user, subject, contents, authorizationHeader)
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default NotificationController;
