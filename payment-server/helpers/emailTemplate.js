import {
    USDST_ADDRESS,
  } from "./constants.js";
  import BigNumber from "bignumber.js";
  
// Define the function
function generateHtmlContent(customerFirstName, concatenatedOrderString) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Order Confirmation</title>
        <style>
            body {
                font-family: Arial, sans-serif;
            }
            .container {
                margin: 20px auto;
                padding: 20px;
                background-color: #ffffff;
                border-radius: 10px;
                border: 1px solid #0A1B71;
                max-width: 600px;
            }
            h2 {
                color: #0A1B71;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            p {
                margin: 10px 0;
            }
            .signature {
                display: flex;
                align-items: center;
            }
            .logo {
                margin-right: 10px;
                width: 60px;
                height: 60px;
            }
            .logo-text {
                color: #000;
                font-weight: 100;
            }
            .footer {
                font-size: 10px;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Hello <strong>${customerFirstName},</strong></h2>
            
            <p>Thank you for shopping with us. Your recent order on the BlockApps Mercata Marketplace has been successfully processed. Below are the details of your purchase:</p>
            
            <ul>
                ${concatenatedOrderString}
            </ul>
            
            <p>If you have any questions or need assistance with your order, please feel free to contact our customer support team at sales@blockapps.net.</p>
            
            <div class="signature">
            <img class="logo" src="https://blockapps.net/wp-content/uploads/2022/08/blockapps-avatar.jpg" alt="Logo" />

                <h3 class="logo-text">BlockApps Mercata Marketplace <a href="https://blockapps.net/products/strato-mercata/" rel="noopener noreferrer"><em>powered by STRATO Mercata™</em><a></h3>
            </div>
            <p class="footer">This email was sent from a notification-only address and cannot accept incoming email. Please do not reply to this message.</p>
        </div>
    </body>
    </html>
    `;
  }

// Not used right now. Purpose is to use it for order cancellations on payment failures.
  function generateHtmlContentForCancellation(customerFirstName, concatenatedOrderString, cancellationReason) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Order Confirmation</title>
        <style>
            body {
                font-family: Arial, sans-serif;
            }
            .container {
                margin: 20px auto;
                padding: 20px;
                background-color: #ffffff;
                border-radius: 10px;
                border: 1px solid #0A1B71;
                max-width: 600px;
            }
            h2 {
                color: #0A1B71;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            p {
                margin: 10px 0;
            }
            .signature {
                display: flex;
                align-items: center;
            }
            .logo {
                margin-right: 10px;
                width: 60px;
                height: 60px;
            }
            .logo-text {
                color: #000;
                font-weight: 100;
            }
            .footer {
                font-size: 10px;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Hello <strong>${customerFirstName},</strong></h2>
            
            <p>Your recent order on the BlockApps Mercata Marketplace has been canceled due to a payment failure:</p><br><br>
            
            <ul>
                <p><b>
                ${cancellationReason}
                </p></b>
            </ul><br><br>

            <p>Below are the details of your order:</p>
            
            <ul>
                ${concatenatedOrderString}
            </ul>

            
            <p>If you have any questions or need assistance with your order, please feel free to contact our customer support team at sales@blockapps.net.</p>
            
            <div class="signature">
            <img class="logo" src="https://blockapps.net/wp-content/uploads/2022/08/blockapps-avatar.jpg" alt="Logo" />

                <h3 class="logo-text">BlockApps Mercata Marketplace <a href="https://blockapps.net/products/strato-mercata/" rel="noopener noreferrer"><em>powered by STRATO Mercata™</em><a></h3>
            </div>
            <p class="footer">This email was sent from a notification-only address and cannot accept incoming email. Please do not reply to this message.</p>
        </div>
    </body>
    </html>
    `;
  }

  // Generating Email Confirmation HTML
  const buildConcatenatedOrderString =  (username, orderData, assetData, isCanceled = false) => {
    let customerFirstName = username;
    
    // Construct Email with order details
    let concatenatedOrderString = '';
    let orderTotal = 0; 
    for (let i = 0; i < orderData.length; i++) {
      let orderItem = orderData[i];

      const decimalPlaces = orderItem.root === USDST_ADDRESS ? 18 : 0;

      const unitPrice = new BigNumber(orderItem.unitPrice);
      const quantity = new BigNumber(orderItem.qty);
      const multiplier = new BigNumber(10).pow(decimalPlaces);
    
      let itemName = decodeURIComponent(orderItem.name);
      let itemPrice = unitPrice.multipliedBy(multiplier).toFixed(2);
      let itemQty = quantity.dividedBy(multiplier).toString();
      let itemTotal = (itemPrice.multipliedBy(itemQty)).toFixed(2); 
  
      concatenatedOrderString += `${itemName}:\n`; 
      concatenatedOrderString += `$${itemTotal} <br>`; 
      concatenatedOrderString += `Qty: ${itemQty} &nbsp; $${itemPrice} each<br><br>`; 
      orderTotal += parseFloat(itemTotal); 
      if (i === orderData.length - 1) {
        concatenatedOrderString += `<hr style="border-top: 1px dotted #0A1B71; min-width: 80%; max-width: 80%; margin-left: 15px;">`;
        concatenatedOrderString += `Shipping Fee: <i><strong>Free</strong></i><br><br>`;
        concatenatedOrderString += `Order Total: $${orderTotal.toFixed(2)} <br>`;
      }
    }
    
    if(isCanceled){
        return generateHtmlContentForCancellation(customerFirstName, concatenatedOrderString, cancellationReason);
    }else{
        return generateHtmlContent(customerFirstName, concatenatedOrderString);
    }
        
  };

  // Export the function
  export { generateHtmlContent, generateHtmlContentForCancellation, buildConcatenatedOrderString };