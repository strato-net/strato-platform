export const TransferSender = (
  senderCommonName,
  itemName,
  itemQuantity,
  itemValue,
  recipientCommonName,
) => {
  const htmlContent = `
  <p>Hello ${senderCommonName},</p>
  <p>We wanted to let you know that your recent item transfer has been successfully processed. Below are the details of your transfer:</p>
  <ul>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Total Value:</strong> ${itemValue}</li>
      <li><strong>Recipient:</strong> ${recipientCommonName}</li>
  </ul>
  <p>If you have any questions or need assistance with your transfer, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
  <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const TransferRecipient = (
  recipientCommonName,
  itemName,
  itemQuantity,
  itemValue,
  senderCommonName,
) => {
  const htmlContent = `
  <p>Hello ${recipientCommonName},</p>
  <p>We’re excited to inform you that you’ve received an item transfer! Below are the details of the transfer:</p>
  <ul>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Total Value:</strong> $${itemValue}</li>
      <li><strong>Sender:</strong> ${senderCommonName}</li>
  </ul>
  <p>If you have any questions or need assistance with your transfer, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
  <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const RedemptionRequestToIssuer = (
  issuerCommonName,
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  requestComments
) => {
  const htmlContent = `
  <p>Hello ${issuerCommonName},</p>
    <p>A redemption request has been submitted for your review. Below are the details of the request:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${requestComments}</li>
  </ul>
    <p>Please review the request and take the necessary action. If you need any further assistance, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;
  return htmlContent;
};

export const RedemptionRequestToRedeemer = (
  redeemerCommonName,
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  requestComments
) => {
  const htmlContent = `
  <p>Hello ${redeemerCommonName},</p>
    <p> Your redemption request was successfully sent. Here is a copy of the redemption details:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${requestComments}</li>
  </ul>
    <p>If you need any further assistance, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const RedemptionApprovalToIssuer = (
  approverCommonName,
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  comment
) => {
  const htmlContent = `
  <p>Hello ${approverCommonName},</p>
    <p>You successfully approved a redemption request. Below are the details of the redemption:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${comment}</li>
  </ul>
    <p>If you need any assistance, feel free to contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const RedemptionApprovalToRedeemer = (
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  comment
) => {
  const htmlContent = `
  <p>Hello ${redeemerName},</p>
    <p>We’re happy to inform you that the redemption request has been approved. Below are the details of the approved redemption:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${comment}</li>
  </ul>
    <p>Please allow some time for the processing of this redemption. If you need any assistance, feel free to contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const RedemptionRejectionToIssuer = (
  rejectorCommonName,
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  comment
) => {
  const htmlContent = `
  <p>Hello ${rejectorCommonName},</p>
    <p>You’ve successfully rejected a redemption request. Below are the details of the rejection:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${comment}</li>
  </ul>
    <p>For more information regarding this decision or to discuss further options, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};

export const RedemptionRejectionToRedeemer = (
  redeemerName,
  redeemerAddress,
  itemName,
  itemQuantity,
  comment
) => {
  const htmlContent = `<p>Hello ${redeemerName},</p>
    <p>We regret to inform you that the redemption request has been rejected. Below are the details of the rejection:</p>
    <ul>
      <li><strong>Redeemer:</strong> ${redeemerName}</li>
      <li><strong>Redeemer’s Address:</strong> ${redeemerAddress}</li>
      <li><strong>Item:</strong> ${itemName}</li>
      <li><strong>Quantity:</strong> ${itemQuantity}</li>
      <li><strong>Comments:</strong> ${comment}</li>
  </ul>
    <p>For more information regarding this decision or to discuss further options, please contact our customer support team at <a href="mailto:sales@blockapps.net">sales@blockapps.net</a>.</p>
    <p>BlockApps Mercata Marketplace</p>
  <small>powered by STRATO Mercata™</small>
`;

  return htmlContent;
};
