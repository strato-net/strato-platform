const nodemailer = require('nodemailer');
const winston = require("winston-color");

if (!process.env['SENDGRID_API_KEY']) {
  winston.error('Failed to initialize emailer - SENDGRID_API_KEY is not provided.');
  process.exit(1)
}

const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'apikey',
    pass: process.env['SENDGRID_API_KEY'],
  },
});

async function sendEmail(to, subject, text, html = undefined, from=undefined) {
  const options = {
    from: from || "no-reply@blockapps.net", // verified sender email
    to: to, // recipient email
    subject: subject, // Subject line
    text: text, // plain text body
    html: html, // html body
  }
  try {
    const info = await transporter.sendMail(options)
    winston.log(`Email sent to ${to}: ` + info.response);
    return info
  } catch (err) {
    winston.error(`Failed to send an email`, err);
    throw err
  }
}

module.exports = {
  sendEmail
}
