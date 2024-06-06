import dotenv from 'dotenv';
import fs from 'fs';
import pg from 'pg';
const { Client } = pg;
dotenv.config();

const host = process.env.POSTGRES_SERVER_URL || 'postgres';
const port = process.env.POSTGRES_PORT || '5432';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD;
const database = process.env.POSTGRES_DBNAME || 'postgres';

let client;

const connectToDB = async () => {
    client = new Client({
        host,
        port,
        user,
        password,
        database
    });
    await client.connect()
        .then(() => {
            console.log(`Connected to the PostgreSQL database. Database name: ${client.database}`);

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
                    createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS redemptions (
                    redemption_id INTEGER PRIMARY KEY,
                    quantity INTEGER,
                    ownerComments TEXT,
                    issuerComments TEXT,
                    ownerCommonName TEXT,
                    issuerCommonName TEXT,
                    assetAddresses TEXT[],
                    assetName TEXT,
                    status INTEGER,
                    shippingAddressId INT REFERENCES customer_address(address_id),
                    createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS stripe_accounts (
                    commonName TEXT PRIMARY KEY,
                    accountId TEXT,
                    createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS stripe_payments (
                    orderHash TEXT PRIMARY KEY,
                    paymentSessionId TEXT,
                    sellerCommonName TEXT REFERENCES stripe_accounts(commonName),
                    status TEXT,
                    createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
                );

                CREATE TABLE IF NOT EXISTS metamask (
                    username TEXT PRIMARY KEY,
                    eth_address TEXT,
                    supported_tokens TEXT[]
                );
            `;

            return client.query(query);
        })
        .then(() => {
            console.log('Table created or already exists.');
        })
        .catch(async (error) => {
            console.error('Error creating table:', error);
            client.end();
            if (error.code === 'ECONNREFUSED') {
                console.log('Attempting to reconnect to DB after 3 seconds...');
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
                await sleep(3000);
                connectToDB();
            }
        })
} 

if (host && password) {
    connectToDB();
} else {
    console.error('CRITICAL ERROR: Missing Postgres URL and/or password');
    process.exit(1)
}

export default client;

