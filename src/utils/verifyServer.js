const http = require('http');
const db = require('../database');

let server;

function startVerifyServer() {
    const port = process.env.VERIFY_PORT || 3001;
    const secret = process.env.PLUGIN_SECRET || '';

    server = http.createServer((req, res) => {
        // Helper to send JSON response
        const sendJson = (status, data) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        };

        if (req.method === 'POST' && req.url === '/verify-ingame') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });

            req.on('end', async () => {
                try {
                    if (secret) {
                        const authHeader = req.headers['authorization'] || '';
                        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
                        if (token !== secret) {
                            return sendJson(403, { error: 'Forbidden' });
                        }
                    }

                    const parsed = JSON.parse(body);
                    const { code, minecraft_username, minecraft_uuid } = parsed;

                    if (!code || !minecraft_username) {
                        return sendJson(400, { error: 'Missing code or minecraft_username' });
                    }

                    const upperCode = code.toUpperCase().trim();

                    // STRICT CHECK: The verification code MUST match the applying username exactly.
                    const rows = await db.query(`
            SELECT id FROM applications 
            WHERE verification_code = ?
            AND LOWER(minecraft_username) = LOWER(?)
            AND status = 'pending'
            LIMIT 1
          `, [upperCode, minecraft_username]);

                    if (!rows || rows.length === 0) {
                        return sendJson(404, { error: 'Code not found, already used, or username mismatch' });
                    }

                    // Mark as verified in-game, and optionally save their UUID if the column exists
                    try {
                        await db.query(`
              UPDATE applications 
              SET verified_in_game = 1, minecraft_uuid = ? 
              WHERE id = ?
            `, [minecraft_uuid || null, rows[0].id]);
                    } catch (updateErr) {
                        // Fallback if minecraft_uuid column doesn't exist yet
                        await db.query(`
              UPDATE applications 
              SET verified_in_game = 1 
              WHERE id = ?
            `, [rows[0].id]);
                    }

                    console.log(`[VerifyServer] [Test] Account strict-verified: ${minecraft_username}`);
                    return sendJson(200, { success: true, message: 'Verified!' });

                } catch (error) {
                    console.error('[VerifyServer] Error processing request:', error);
                    return sendJson(500, { error: 'Internal server error' });
                }
            });
        } else {
            sendJson(404, { error: 'Not Found' });
        }
    });

    server.listen(port, () => {
        console.log(`[VerifyServer] Listening for Minecraft plugin on port ${port}`);
    });
}

function stopVerifyServer() {
    if (server) {
        server.close();
    }
}

module.exports = { startVerifyServer, stopVerifyServer };
