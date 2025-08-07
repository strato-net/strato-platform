import sgMail from '@sendgrid/mail';
import { MailDataRequired } from '@sendgrid/mail';
import logger from '../utils/logger';
import { config } from '../config';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const sendEmail = async (txHash: string) => {
  const emailAddresses = process.env.TRANSACTION_APPROVER_EMAILS?.split(',').map(email => email.trim());
  const safeAddress = config.safe.address;

  const safeTxLink = `https://app.safe.global/transactions/tx?safe=sep:${safeAddress}&id=multisig_${safeAddress}_${txHash}`;

  const msg: MailDataRequired = {
    to: emailAddresses || [],
    from: 'info@blockapps.net',
    subject: 'New Bridge Transaction Proposed and Pending Approval',
    text: `Please review and approve the transaction: ${safeTxLink}`
  };

  await sgMail.send(msg);
  logger.info('Transaction notification email sent successfully to:', emailAddresses?.join(', ') || '');
}

export default sendEmail;
