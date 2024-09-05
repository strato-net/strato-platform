import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
const { Client } = pg;
dotenv.config();

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const host = process.env.POSTGRES_SERVER_URL || 'postgres';
const port = process.env.POSTGRES_PORT || '5432';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD;
const database = process.env.POSTGRES_DBNAME || 'postgres';
const ssl = (process.env.POSTGRES_SERVER_URL !== 'postgres') ?
    {
        require: true,
        rejectUnauthorized: true,
        ca: fs.readFileSync(path.join(__dirname,'../dbCert/us-east-1-bundle.cer')).toString()
    } 
    : false

let client;

const connectToDB = async () => {
    client = new Client({
        host,
        port,
        user,
        password,
        database,
        ssl
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
            if (error.code === 'ECONNREFUSED') {
                console.log('Attempting to reconnect to DB after 3 seconds...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                await connectToDB();
            } else {
                client.end();
                process.exit(1);
            }
        })
} 

if (host && password) {
    await connectToDB();
} else {
    console.error('CRITICAL ERROR: Missing Postgres URL and/or password');
    process.exit(1)
}

export default client;

