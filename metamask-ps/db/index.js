const fs = require('fs');
const { Client } = require('pg');

const client = new Client({
    host: process.env.POSTGRESQL_SERVER_URL,
    port: process.env.POSTGRESQL_PORT || '5432',
    user: process.env.POSTGRESQL_USER || 'postgres',
    password: process.env.POSTGRESQL_PASSWORD,
    database: process.env.POSTGRESQL_DBNAME || 'postgres',
    // TODO re-enable after testing
    // ssl: {
    //     require: false,
    //     rejectUnauthorized: false,
    //     ca: fs.readFileSync('db/cert/us-east-1-bundle.cer').toString(),
    // }
});

if (process.env.POSTGRESQL_SERVER_URL && process.env.POSTGRESQL_PASSWORD) {
    client.connect()
        .then(() => {
            console.log(`Connected to the PostgreSQL database. Database name: ${client.database}`);

            const query = `
                CREATE TABLE IF NOT EXISTS metamask (
                    username TEXT PRIMARY KEY,
                    eth_address TEXT
                );
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

module.exports = client;

