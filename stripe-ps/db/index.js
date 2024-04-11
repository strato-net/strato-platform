import sqlite3 from 'sqlite3';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DBSOURCE = process.env.DOCKERIZED === "true" ? "/sqlitedb/db.sqlite" : "db.sqlite";

const db = new sqlite3.Database(path.resolve(__dirname, DBSOURCE), (err) => {
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


export default db;
