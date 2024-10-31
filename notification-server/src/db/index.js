require("dotenv").config();
const fs = require("fs");
const { Client } = require("pg");

const host = process.env.POSTGRES_SERVER_URL || "localhost";
const port = process.env.POSTGRES_PORT || "5432";
const user = process.env.POSTGRES_USER || "postgres";
const password = process.env.POSTGRES_PASSWORD;
const database = process.env.POSTGRES_DBNAME || "postgres";

if (!host || !password) {
  console.error("CRITICAL ERROR: Missing Postgres URL and/or password");
  process.exit(1);
}

const client = new Client({
  host,
  port,
  user,
  password,
  database,
  ssl: {
    require: true,
    rejectUnauthorized: true,
    ca: fs.readFileSync("./src/dbCert/us-east-1-bundle.cer").toString(),
  },
});

const connectToDB = async () => {
  try {
    await client.connect();
    console.log(
      `Connected to the PostgreSQL database. Database name: ${client.database}`
    );

    const query = `
            CREATE TABLE IF NOT EXISTS contact_info (
                username TEXT PRIMARY KEY,
                email TEXT
            );
        `;

    await client.query(query);
    console.log("Table created or already exists.");
  } catch (error) {
    console.error("Error creating table:", error);
    if (error.code === "ECONNREFUSED") {
      console.log("Attempting to reconnect to DB after 3 seconds...");
      setTimeout(connectToDB, 3000);
    } else {
      await client.end();
      process.exit(1);
    }
  }
};

connectToDB();

module.exports = client;
