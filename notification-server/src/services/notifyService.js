require("dotenv").config();

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const env = process.env.NODE_ENV || "development";

// Function to send email
const sendEmail = async (emails, message) => {
  const { subject, htmlContent } = message;

  const msg = {
    to: emails,
    from: { email: "no_reply@blockapps.net", name: "BlockApps.net" },
    subject,
    html: htmlContent,
  };

  // Remove sales from these emails for testnet testing. This needs to be included for production.
  if (env === "production") {
    if (emails.includes("sales@blockapps.net")) {
      // No BCC needed
    }
    else { msg.bcc = "sales@blockapps.net"; }
    // attachments: [
    //   {
    //     content: pdf.toString('base64'),
    //     filename: 'certificate.pdf',
    //     type: 'application/pdf',
    //     disposition: 'attachment',
    //   },
    // ],
  }

  try {
    await sgMail.sendMultiple(msg);
    console.log("Emails sent successfully!");
  } catch (error) {
    console.error("Error sending emails:", error);
    throw error;
  }
};

// // Function to send SMS
// const sendSMS = async (usernames, message) => {
//   try {
//     // Implement your SMS sending logic here
//     console.log("Sending SMS to:", usernames, "with message:", message);
//     // Replace with actual SMS sending implementation
//     return Promise.resolve();
//   } catch (error) {
//     console.error("Error sending SMS:", error);
//     throw error; // Re-throw the error to be handled by the caller if needed
//   }
// };

module.exports = {
  sendEmail,
  //   sendSMS,
};
