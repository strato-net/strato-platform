// const sqlite3 = require('sqlite3').verbose();
// const path = require('path');

// const DBSOURCE = process.env.DOCKERIZED === "true" ? "/sqlitedb/db.sqlite" : "db.sqlite";

// const db = new sqlite3.Database(path.resolve(__dirname, DBSOURCE), (err) => {
//     if (err) {
//       // Cannot open database
//       console.error(err.message)
//       throw err
//     }else{
//         console.log('Connected to the SQLite database.')
//         db.run(`CREATE TABLE IF NOT EXISTS customer_address (
//             address_id INTEGER PRIMARY KEY AUTOINCREMENT,
//             commonName text, 
//             name text, 
//             zipcode text,
//             state text,
//             city text,
//             addressLine1 text,
//             addressLine2 text,
//             country text,
//             createdDate DATETIME DEFAULT CURRENT_TIMESTAMP
//             )`,
//         (err) => {
//             if (err) {
//                 // Table already created
//             }
//         });  
//     }
// });


// module.exports = db;
// import fs from 'fs';
const fs = require('fs');
const { Client } = require('pg');
const { cli } = require('winston/lib/winston/config');

// psql --host=payments-dev.cbx3kn52dupr.us-east-1.rds.amazonaws.com --port=5432 --username=postgres  --password --dbname=postgres
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

client.connect().catch(error => 
    console.error(error)
)
    const query = 'SELECT * FROM customer_address';
    // const values = [req.params.commonName];

    const result =  client.query(query).then(result =>
    console.log('Query Result',  result)
    
    )



// client.connect()
//     .then(() => {
//         console.log('Connected to the PostgreSQL database.');

//         const query = `
//             CREATE TABLE IF NOT EXISTS customer_address (
//             address_id SERIAL PRIMARY KEY,
//             commonName TEXT,
//             name TEXT,
//             zipcode TEXT,
//             state TEXT,
//             city TEXT,
//             addressLine1 TEXT,
//             addressLine2 TEXT,
//             country TEXT,
//             createdDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`;

//         return client.query(query);
//     })
//     .then(() => {
//         console.log('Table created or already exists.');
//     })
//     .catch(error => {
//         console.error('Error creating table:', error);
//     })
//     .finally(() => {
//         client.end();
//     });

module.exports = client;

