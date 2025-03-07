const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'exo-map-server.mysql.database.azure.com',
    user: process.env.DB_USER || 'cxsdtukujc',
    password: process.env.DB_PASSWORD || 'n$EaiPNlOPXAvwLj',
    database: process.env.DB_NAME || 'exo-map-database',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: true
    }
});

module.exports = pool; 