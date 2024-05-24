import client from '../db/index.js';
import { completeOrder, getPaymentEvent, emitOnboardSeller, validateAndGetOrderDetails } from '../helpers/utils.js';
import { METAMASK_CONTRACT_ADDRESS } from '../helpers/constants.js';
import { Interface, parseEther, parseUnits } from 'ethers';

class MetaMaskController {
    static async onboarding(req, res, next) {
        try {
            res.status(200)
            res.sendFile(process.cwd() + '/MetaMask/onboarding.html')
        } catch (error) {
            console.log(error)
            next(error);
        }
    }

    static async completeOnboarding(req, res, next) {
        try {
            const { username, address, redirectUrl } = req.query;

            if (!username || !address) {
                throw new Error('Missing username OR eth_address in GET request')
            }

            const { supported_tokens } = req.body;

            const query = `INSERT INTO metamask (
                username,
                eth_address,
                supported_tokens
            ) VALUES ($1, $2, $3);`

            await client.query(query, [req.query.username, req.query.address, supported_tokens])

            // Call onboardSeller
            const callArgs = {
              sellersCommonName: username,
              isActive: true,
            }
            const onboardSellerStatus = await emitOnboardSeller(METAMASK_CONTRACT_ADDRESS, callArgs);
            console.log("onboardSellerStatus", onboardSellerStatus);

            res.status(204); // Success without content

            next();
        } catch (error) {
            console.log(error)
            next(error);
        }
    }
    
    static async onboardingStatus(req, res, next) {
        try {
            if (!req.query.username) {
                throw new Error('Missing username in GET request')
            }

            const query = 'SELECT * FROM metamask WHERE username = $1;'
            const query_result = await client.query(query, [req.query.username])
            
            if (query_result.rows.length === 1) {
                res.status(200).json({
                    onboarded: true,
                });
            } else {
                res.status(404).json({
                    onboarded: false,
                })
            }

            next();
        } catch (error) {
            console.error('DB Error:', error.message);
            next(error);
        }    
    }

    static async checkout(req, res, next) {
        try {
            res.status(200)
            res.sendFile(process.cwd() + '/MetaMask/checkout.html')
        } catch (error) {
            console.log(error)
            next(error);
        }
    }

    static async getTxParams(req, res, next) {
        try {            
            const { checkout_total, currency, username } = req.query; 
            const query = 'SELECT eth_address FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [username])
            
            if (query_result.rows.length === 0) {
                res.status(500).json({
                    error: "This user has not been onboarded through MetaMask yet."
                });
            } else {
                // TODO: specify network ID for mainnet vs testnets
                const seller_address = query_result.rows[0].eth_address;
                switch (currency) {
                    case 'ETH':
                        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
                        const response = await fetch(url);

                        if (!response.ok) {
                            throw new Error('Network response was not ok ' + response.statusText);
                        }

                        const coin_gecko_response = await response.json();
                        const eth_usd_price = coin_gecko_response.ethereum.usd;
                        console.log(`checkout_total: ${checkout_total}`)
                        console.log(`eth_usd_price: ${eth_usd_price}`)
                        const eth_amount = (Math.round((checkout_total * 100000000) / eth_usd_price)/1000000000).toString() // amount in ether
                        console.log(`eth_amount: ${eth_amount}`)
                        const amount_in_wei = parseEther(eth_amount).toString() // amount in wei
                        console.log(`amount_in_wei: ${amount_in_wei}`)

                        console.log(eth_amount)
                        console.log(amount_in_wei)
                        
                        res.status(200).json({
                            to: seller_address,
                            value: amount_in_wei
                        });
                        break;
                    case 'USDC':
                        const to = '0xA0b86991c6218b36c1d19D4a2e9EB0cE3606EB48'; // USDC contract address (mainnet)
                        const usdc_abi = [ "function transfer(address to, uint amount) public returns (bool)" ];
                        const amount = parseUnits(checkout_total.toString(), 6);
                        const iface = new Interface(usdc_abi)
                        const data = iface.encodeFunctionData('transfer', [seller_address, amount.toString()])

                        res.status(200).json({
                            to: to,
                            data: data
                        })
                        break;
                }
            }
        } catch (error) {
            console.log(error);
            next(error);
        }
    }

    static async completeCheckout(req, res, next) {
        const { checkout_total, currency, token } = req.query; 
        const paymentEvent = await getPaymentEvent(token);

        // Call completeOrder
        const callArgs = {
          token: paymentEvent[0].token,
          orderId: paymentEvent[0].orderId,
          purchaser: paymentEvent[0].purchaser,
          saleAddresses: paymentEvent[0].saleAddresses,
          quantities: paymentEvent[0].quantities,
        } 
        const returnStatus = await completeOrder(METAMASK_CONTRACT_ADDRESS, callArgs);
        res.status(200).json({
            assets: returnStatus,
        })
    }

    static async changeUserWallet(req, res, next) {

    }

    static async orderInfo(req, res, next) {
        try {
            const { token } = req.query;
            // Get the payment event from Cirrus
            const paymentEvent = await getPaymentEvent(token);

            // Get and validate the order details
            const saleAddresses = paymentEvent[0].saleAddresses;
            const quantities = paymentEvent[0].quantities;
            const { sellerCommonName, orderDetails } = await validateAndGetOrderDetails(quantities, saleAddresses);
            const query = 'SELECT supported_tokens FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [sellerCommonName])
            res.status(200).json({
                sellerCommonName,
                orderDetails,
                paymentEvent: paymentEvent[0],
                supported_tokens: query_result.rows[0].supported_tokens
            });
        } catch (error) {
            console.log(error);
            next(error);
        }
    }

    static async orderStatus(req, res, next) {
        res.status(200); // TODO
    }
}

export default MetaMaskController;