const client = require('../db');
// const Joi = require('@hapi/joi');
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

            const query = `INSERT INTO metamask (
                username,
                eth_address
            ) VALUES ($1, $2);`;

            await client.query(query, [req.query.username, req.query.address])

            res.status(200)
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

            return next();

        } catch (error) {
            console.error('DB Error:', error.message);
            next(error);
        }    
    }

    static async checkout(req, res, next) {

    }
}

module.exports = MetaMaskController;