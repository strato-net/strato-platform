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

                <h3 class="logo-text">BlockApps Marketplace <a href="https://blockapps.net/products/strato-mercata/" rel="noopener noreferrer"><em>powered by STATO Mercata™</em><a></h3>
            </div>
            <p class="footer">This email was sent from a notification-only address and cannot accept incoming email. Please do not reply to this message.</p>
        </div>
    </body>
    </html>
    `;
  }
  
  // Define the function
function generateHtmlContentNickel(customerFirstName, nickel ) {
    const weight = nickel.itemQty * 5;
    let itemName = nickel.itemName.replace(/%20/g, ' '); 
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
                font-size: 16px; 
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
            <h2>Hi <strong>${customerFirstName},</strong></h2>
            
            <p>STRATO Mercata Materials has received your deposit of $${nickel.orderTotal} for your reservation of ${weight}kg of ${itemName}. When our current bulk purchasing round is fully subscribed, you will receive an email. You will then have 72 hours to transfer the remainder of the money you committed. If you fail to pay your full balance, you will lose your deposit.</p>
            
            <p> You may receive a full refund for your deposit (net fees from the payment processor) at any time up until the purchasing round is fully subscribed. You can check how close we are to becoming fully subscribed by looking at the progress bar on the ${itemName} page [INSERT LINK] on the STRATO Mercata marketplace.</p>
            
            <p>Thank you for your commitment!.</p>
            
            <div class="signature">
            <img class="logo" src="https://blockapps.net/wp-content/uploads/2022/08/blockapps-avatar.jpg" alt="Logo" />

                <h3 class="logo-text">BlockApps Marketplace <a href="https://blockapps.net/products/strato-mercata/" rel="noopener noreferrer"><em>powered by STATO Mercata™</em><a></h3>
            </div>
            <p class="footer">This email was sent from a notification-only address and cannot accept incoming email. Please do not reply to this message.</p>
        </div>
    </body>
    </html>
    `;
  }
  
  // Export the function
  export { generateHtmlContent, generateHtmlContentNickel };
  