const client = require('../db');
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
            // Focusing on ETH and USDC
            // Need a flag that triggers network (Mainnet, )
            const { price } = req.body; 
            const query = 'SELECT eth_address FROM metamask WHERE username = $1';
            const query_result = await client.query(query, [req.query.username])
            
            if (query_result.rows.length != 1) {
                res.status(500).json({
                    error: "This user has not been onboarded through MetaMask yet."
                });
            } 


        } catch (error) {
            console.log(error);
            next(error);
        }

    }

    static async changeUserWallet(req, res, next) {

    }
}

module.exports = MetaMaskController;