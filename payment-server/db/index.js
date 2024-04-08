const fs = require('fs');
const { Client } = require('pg');

const client = new Client({
    host: 'payments-dev.cbx3kn52dupr.us-east-1.rds.amazonaws.com',
    port: 5432,
    user: 'postgres',
    password: '}fa9t4+JJ*3wme?Wp]t1tHT{kzP0',
    dbname: 'postgres',
    // ssl: true,
    // dialect: 'postgres',
    ssl: { 
        require: true,
        rejectUnauthorized: true,
        ca: fs.readFileSync('./dbCert/us-east-1-bundle.cer').toString(), 
      } 
    

});

client.connect()
    .then(() => {
        console.log('Connected to the PostgreSQL database.');

        const query = `
            CREATE TABLE IF NOT EXISTS customer_address (
            address_id SERIAL PRIMARY KEY,
            commonName TEXT,
            name TEXT,
            zipcode TEXT,
            state TEXT,
            city TEXT,
            addressLine1 TEXT,
            addressLine2 TEXT,
            country TEXT,
            createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`;

        return client.query(query);
    })
    .then(() => {
        console.log('customer_address Table created or already exists.');

        const createMetamaskWalletTable = `
            CREATE TABLE IF NOT EXISTS metamask_wallet (
                id SERIAL PRIMARY KEY,
                commonName TEXT,
                walletAddress TEXT,
                createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );`;

        return client.query(createMetamaskWalletTable);
    })
    .then(() => {
        console.log('metamask_wallet Table created or already exists.');
    })
    .catch(error => {
        console.error('Error creating table:', error);
    })

module.exports = client;

