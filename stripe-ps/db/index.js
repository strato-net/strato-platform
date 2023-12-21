const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DBSOURCE = process.env.DOCKERIZED === "true" ? "/sqlitedb/db.sqlite" : "db.sqlite";

const db = new sqlite3.Database(path.resolve(__dirname, 'db.sqlite'), (err) => {
    if (err) {
      // Cannot open database
      console.error(err.message)
      throw err
    }else{
        console.log('Connected to the SQLite database.')
        db.run(`CREATE TABLE IF NOT EXISTS customer_address (
            address_id INTEGER PRIMARY KEY AUTOINCREMENT,
            commonName text, 
            name text, 
            zipcode text,
            state text,
            city text,
            addressLine1 text,
            addressLine2 text,
            country text,
            createdDate DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
        (err) => {
            if (err) {
                // Table already created
            }
        });  
    }
});


module.exports = db;
