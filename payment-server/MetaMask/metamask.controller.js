import client from '../db/index.js';
import { completeOrder, getCheckoutEvent, emitOnboardSeller, validateAndGetOrderDetails } from '../helpers/utils.js';
import { METAMASK_CONTRACT_ADDRESS, PAYMENT_RECEIVED_MESSAGE } from '../helpers/constants.js';
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

            // Call onboardSeller
            const callArgs = {
              sellersCommonName: username,
              isActive: true,
            }
            const onboardSellerStatus = await emitOnboardSeller(METAMASK_CONTRACT_ADDRESS, callArgs);
            console.log("onboardSellerStatus", onboardSellerStatus);

            const query = `INSERT INTO metamask (
                username,
                eth_address,
                supported_tokens
            ) VALUES ($1, $2, $3);`

            await client.query(query, [req.query.username, req.query.address, supported_tokens])

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
                const seller_address = query_result.rows[0].eth_address;
                const networkId = process.env.NODE_ENV === 'production' ? '0x1' : '0xaa36a7' // Sepolia network ID
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
                        const eth_amount = (Math.round((checkout_total * 100000000) / eth_usd_price)/100000000).toString() // amount in ether
                        console.log(`eth_amount: ${eth_amount}`)
                        const amount_in_wei = parseEther(eth_amount).toString(16) // amount in wei, hex-encoded
                        console.log(`amount_in_wei: ${amount_in_wei}`)
                        
                        res.status(200).json({
                            to: seller_address,
                            value: amount_in_wei,
                            networkId
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
                            data: data,
                            networkId
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
        const { checkout_total, currency, checkoutHash } = req.body; 
        const checkoutEvent = await getCheckoutEvent(checkoutHash);

        // Call completeOrder
        const callArgs = {
          orderHash: checkoutEvent[0].checkoutHash,
          orderId: checkoutEvent[0].orderId,
          purchaser: checkoutEvent[0].purchaser,
          saleAddresses: checkoutEvent[0].saleAddresses,
          quantities: checkoutEvent[0].quantities,
          currency: currency,
          createdDate: checkoutEvent[0].createdDate,
          comments: PAYMENT_RECEIVED_MESSAGE,
        } 
        const returnStatus = await completeOrder(METAMASK_CONTRACT_ADDRESS, callArgs);
        res.status(200).json({
            assets: returnStatus,
        })
    }

    static async changeUserWallet(req, res, next) {

    }

    // TODO: Handle MetaMask

    static async orderInfo(req, res, next) {
        try {
            // Validation
            const { orderHash } = req.query;
            const checkoutEvent = await getCheckoutEvent(orderHash);

            // Get and validate the order details
            const saleAddresses = checkoutEvent[0].saleAddresses;
            const quantities = checkoutEvent[0].quantities;
            const { sellerCommonName, orderDetails } = await validateAndGetOrderDetails(quantities, saleAddresses);
            const query = 'SELECT supported_tokens FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [sellerCommonName])
            res.status(200).json({
                sellerCommonName,
                orderDetails,
                checkoutEvent: checkoutEvent[0],
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