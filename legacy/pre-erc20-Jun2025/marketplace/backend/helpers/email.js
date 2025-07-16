import axios from 'axios';
import dotenv from 'dotenv';
import config from '../load.config';
import { util } from '../blockapps-rest-plus';

dotenv.config({ path: '../../../.env' });

async function sendEmail(to, subject, htmlContent) {
  const url = process.env.NOTIFICATION_SERVER_URL;
  const { token } = await util.getApplicationCredentials({ config });
  const reqBody = {
    usernames: [to],
    message: {
      subject: subject,
      htmlContent: htmlContent,
    },
  };
  try {
    const response = await axios.post(`${url}/notify`, reqBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200 || response.status === 201) {
      console.log('Email sent successfully');
    }
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

export default sendEmail;
