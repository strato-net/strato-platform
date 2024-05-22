const client = require('../db');
const ethers = require('ethers')

class MetaMaskController {
    static async onboarding(req, res, next) {
        try {
            res.status(200)
            res.sendFile(__dirname + '/onboarding.html')
        } catch (error) {
            console.log(error)
            next(error);
        }
    }

    static async completeOnboarding(req, res, next) {
        try {
            if (!req.query.username || !req.query.address) {
                throw new Error('Missing username OR eth_address in GET request')
            }

            const { supported_tokens } = req.body;

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
            res.sendFile(__dirname + '/checkout.html')
        } catch (error) {
            console.log(error)
            next(error);
        }
    }

    static async completeCheckout(req, res, next) {
        try {            
            const { checkout_total, token } = req.body; 
            const query = 'SELECT eth_address FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [req.query.username])
            
            if (query_result.rows.length === 0) {
                res.status(500).json({
                    error: "This user has not been onboarded through MetaMask yet."
                });
            } else {
                // TODO: specify network ID for mainnet vs testnets
                const seller_address = query_result.rows[0].eth_address;
                switch (token) {
                    case 'ETH':
                        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
                        const response = await fetch(url);

                        if (!response.ok) {
                            throw new Error('Network response was not ok ' + response.statusText);
                        }

                        const coin_gecko_response = await response.json();
                        const eth_usd_price = coin_gecko_response.ethereum.usd;
                        const eth_amount = (checkout_total / eth_usd_price).toString() // amount in ether
                        const amount_in_wei = ethers.parseEther(eth_amount).toString() // amount in wei

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
                        const amount = ethers.parseUnits(checkout_total.toString(), 6);
                        const iface = new ethers.Interface(usdc_abi)
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

    static async paymentOptions(req, res, next) {
        try {
            const query = 'SELECT supported_tokens FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [req.query.seller])

            res.status(200).json(query_result.rows[0])
        } catch (error) {
            console.log(error);
            next(error);
        }
    }

    static async changeUserWallet(req, res, next) {

    }
}

module.exports = MetaMaskController;