const dbConfig = {
  development: {
    username: 'postgres',
    password: 'api',
    database: 'eth',
    host: 'localhost',
    port: '15433',
    dialect: 'postgres',
  },
  test: {
    username: 'postgres',
    password: 'api',
    database: 'eth',
    host: 'postgres',
    port: '5432',
    dialect: 'postgres',
  },
  production: {
    username: '__strato_postgres_user__',
    password: '__strato_postgres_password__',
    database: 'eth',
    host: '__strato_postgres_host__',
    port: '__strato_postgres_port__',
    dialect: 'postgres',
    logging: false,
  },
};

module.exports = {dbConfig};
