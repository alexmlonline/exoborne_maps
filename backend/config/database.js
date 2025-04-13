const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: false,
    connectionLimit: 10,
    queueLimit: 0
});

console.log('- DB_HOST:',process.env.DB_HOST);
console.log('- DB_USER:',process.env.DB_USER);
console.log('- DB_PASSWORD:',process.env.DB_PASSWORD?.slice(0, 3));
console.log('- DB_NAME:',process.env.DB_NAME);

module.exports = pool; 