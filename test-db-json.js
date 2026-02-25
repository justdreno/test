require('dotenv').config();
const mysql = require('mysql2/promise');

async function test() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const [rows] = await db.execute(`SELECT permissions FROM testers LIMIT 1`);
    console.log(rows);
    console.log('type:', typeof rows[0].permissions);
    console.log('isArray:', Array.isArray(rows[0].permissions));
    db.end();
}
test();
