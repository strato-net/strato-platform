import dotenv from 'dotenv';
import fs from 'fs';
import pg from 'pg';
const { Client } = pg;
dotenv.config();

const client = new Client({
    host: process.env.POSTGRESQL_SERVER_URL,
    port: process.env.POSTGRESQL_PORT || '5432',
    user: process.env.POSTGRESQL_USER || 'postgres',
    password: process.env.POSTGRESQL_PASSWORD,
    database: process.env.POSTGRESQL_DBNAME || 'postgres',
    ssl: {
        require: true,
        rejectUnauthorized: true,
        ca: fs.readFileSync('./dbCert/us-east-1-bundle.cer').toString(),
    }
});

if (process.env.POSTGRESQL_SERVER_URL && process.env.POSTGRESQL_PASSWORD) {
    client.connect()
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
            createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            CREATE TABLE IF NOT EXISTS stripe_accounts (
            commonName TEXT PRIMARY KEY,
            accountId TEXT,
            createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            `;

            return client.query(query);
        })
        .then(() => {
            console.log('Table created or already exists.');
        })
        .catch(error => {
            console.error('Error creating table:', error);
        })
} else {
    console.error('CRITICAL ERROR: Missing Postgres URL and/or password');
    process.exit(1)
}

export default client;

