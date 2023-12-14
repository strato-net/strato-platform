const sqlite3 = require('sqlite3').verbose();

const DBSOURCE = "db.sqlite";

const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
      // Cannot open database
      console.error(err.message)
      throw err
    }else{
        console.log('Connected to the SQLite database.')
        db.run(`CREATE TABLE customer_address (
            address_id INTEGER PRIMARY KEY AUTOINCREMENT,
            commonName text, 
            name text, 
            zipcode text,
            state text,
            city text,
            addressLine1 text,
            addressLine2 text,
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