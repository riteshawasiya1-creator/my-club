
const express = require('express');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());
app.use(express.static('.'));

const TOKEN = '8965061071:AAF1gKrVvOG7Pg8LNo9F0VnO-Fw6DNEZjh0';
const ADMIN_CHAT_ID = '7511449522'; // आपकी पर्सनल चैट आईडी

let pendingDeposits = {};
let userWallets = {};
let lastUpdateId = 0;

// टेलीग्राम पर मैसेज भेजने का फंक्शन
function sendTelegramMessage(text) {
    const data = JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: text });
    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };
    const req = https.request(options, (res) => {});
    req.on('error', (e) => {});
    req.write(data);
    req.end();
}

// 1. जब यूजर वेबसाइट से UTR और Amount सबमिट करेगा
app.post('/api/submit-deposit', (req, res) => {
    const { userId = 'User_123', amount, utr } = req.body;
    
    if (!amount || !utr) {
        return res.json({ success: false, message: 'Amount aur UTR zaroori hai!' });
    }

    pendingDeposits[utr] = { userId, amount, approved: false };

    const message = `🔔 New Deposit Request!\n\n👤 User: ${userId}\n💰 Amount: ₹${amount}\n🔢 UTR: ${utr}\n\nApprove karne ke liye "yes" bhejein.`;
    sendTelegramMessage(message);

    res.json({ success: true, message: 'Deposit request sent for admin approval.' });
});

// 2. टेलीग्राम से मैसेज चेक करने के लिए ऑटो-पॉलिंग (हर 3 सेकंड में)
setInterval(() => {
    https.get(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastUpdateId + 1}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const response = JSON.parse(body);
                if (response.ok && response.result) {
                    response.result.forEach(update => {
                        lastUpdateId = update.update_id;
                        if (update.message && update.message.text) {
                            const text = update.message.text.trim().toLowerCase();

                            if (text.startsWith('yes')) {
                                const utrKeys = Object.keys(pendingDeposits);
                                if (utrKeys.length > 0) {
                                    const lastUtr = utrKeys[utrKeys.length - 1];
                                    const deposit = pendingDeposits[lastUtr];

                                    if (!deposit.approved) {
                                        deposit.approved = true;
                                        if (!userWallets[deposit.userId]) userWallets[deposit.userId] = 0;
                                        userWallets[deposit.userId] += Number(deposit.amount);

                                        sendTelegramMessage(`✅ Success! ₹${deposit.amount} user ke wallet mein add kar diye gaye hain.\nTotal Balance: ₹${userWallets[deposit.userId]}`);
                                        delete pendingDeposits[lastUtr];
                                    } else {
                                        sendTelegramMessage(`⚠️ Yeh deposit pehle hi approve ho chuka hai.`);
                                    }
                                } else {
                                    sendTelegramMessage(`❌ Koi bhi pending deposit request nahi mili.`);
                                }
                            }
                        }
                    });
                }
            } catch (e) {}
        });
    }).on('error', (e) => {});
}, 3000);


// SQLite Database Connection
const db = new sqlite3.Database('./myclub.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database successfully.');
    }
});

// Users Table बनाना
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    balance REAL DEFAULT 3921262.00
)`, (err) => {
    if (!err) {
        db.run(`INSERT OR IGNORE INTO users (id, username, balance) VALUES (1, 'player1', 3921262.00)`);
    }
});

// 1. User Balance Fetch API
app.get('/api/balance', (req, res) => {
    db.get(`SELECT balance FROM users WHERE id = 1`, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ balance: row ? row.balance : 0 });
        }
    });
});

// 2. Withdraw API
app.post('/api/withdraw', (req, res) => {
    const { amount, account, ifsc } = req.body;
    
    db.get(`SELECT balance FROM users WHERE id = 1`, (err, row) => {
        if (err || !row) {
            return res.json({ success: false, message: 'User not found' });
        }

        if (row.balance < amount) {
            return res.json({ success: false, message: 'Insufficient balance!' });
        }

        let newBalance = row.balance - amount;

        db.run(`UPDATE users SET balance = ? WHERE id = 1`, [newBalance], (updateErr) => {
            if (updateErr) {
                return res.json({ success: false, message: 'Database error' });
            }
            res.json({ success: true, newBalance: newBalance, message: 'Withdrawal successful!' });
        });
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
