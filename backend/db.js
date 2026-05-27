/**
 * Database Module
 * SQLite with same schema as original bot
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor(dbPath) {
        this.db = new sqlite3.Database(dbPath);
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // WAL mode for concurrency
            this.db.run("PRAGMA journal_mode = WAL");
            this.db.run("PRAGMA foreign_keys = ON");

            // Users table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT UNIQUE,
                    password_hash TEXT,
                    nickname TEXT DEFAULT NULL,
                    premium INTEGER DEFAULT 0,
                    premium_until INTEGER DEFAULT 0,
                    balance INTEGER DEFAULT 100,
                    xp INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    games INTEGER DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `);

            // Settings table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS settings (
                    user_id INTEGER PRIMARY KEY,
                    reg_time INTEGER DEFAULT 60,
                    night_time INTEGER DEFAULT 60,
                    day_time INTEGER DEFAULT 120,
                    vote_time INTEGER DEFAULT 30,
                    defense_time INTEGER DEFAULT 30,
                    min_players INTEGER DEFAULT 4,
                    max_players INTEGER DEFAULT 12,
                    show_roles INTEGER DEFAULT 1,
                    mode TEXT DEFAULT 'classic'
                )
            `);

            // Cooldowns table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS cooldowns (
                    user_id INTEGER PRIMARY KEY,
                    work_until INTEGER DEFAULT 0,
                    steal_until INTEGER DEFAULT 0,
                    daily_until INTEGER DEFAULT 0
                )
            `);

            // Bank table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS bank (
                    user_id INTEGER PRIMARY KEY,
                    deposit INTEGER DEFAULT 0,
                    deposited_at INTEGER DEFAULT 0
                )
            `);

            // Shop items
            this.db.run(`
                CREATE TABLE IF NOT EXISTS shop_items (
                    user_id INTEGER,
                    item TEXT,
                    count INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, item)
                )
            `);

            // Role stats
            this.db.run(`
                CREATE TABLE IF NOT EXISTS role_stats (
                    user_id INTEGER,
                    role TEXT,
                    games INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, role)
                )
            `);

            // Achievements
            this.db.run(`
                CREATE TABLE IF NOT EXISTS achievements (
                    user_id INTEGER,
                    ach_id TEXT,
                    unlocked_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (user_id, ach_id)
                )
            `);

            // Game history
            this.db.run(`
                CREATE TABLE IF NOT EXISTS game_history (
                    game_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_id TEXT,
                    winner_team TEXT,
                    player_count INTEGER,
                    duration INTEGER,
                    played_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `);
        });
    }

    // ================= USER METHODS =================

    async createUser(username, passwordHash) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.run(
                `INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
                [username, passwordHash, now],
                function(err) {
                    if (err) reject(err);
                    else resolve({ userId: this.lastID, username });
                }
            );
        });
    }

    async getUserByUsername(username) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM users WHERE username = ?`,
                [username],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async getUserProfile(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT user_id, username, nickname, premium, premium_until, 
                        balance, xp, wins, games, created_at 
                 FROM users WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    async updateUser(userId, updates) {
        const fields = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = fields.map(f => `${f} = ?`).join(', ');

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE users SET ${setClause} WHERE user_id = ?`,
                [...values, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    // ================= BALANCE METHODS =================

    async addBalance(userId, amount) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
                [amount, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    async getBalance(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT balance FROM users WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.balance || 0);
                }
            );
        });
    }

    // ================= LEADERBOARD =================

    async getTopPlayers(limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT user_id, username, nickname, balance, wins, games, xp
                 FROM users 
                 ORDER BY balance DESC 
                 LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // ================= ROLE STATS =================

    async incRoleGame(userId, role) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR IGNORE INTO role_stats (user_id, role) VALUES (?, ?)`,
                [userId, role],
                (err) => {
                    if (err) reject(err);
                    else {
                        this.db.run(
                            `UPDATE role_stats SET games = games + 1 WHERE user_id = ? AND role = ?`,
                            [userId, role],
                            function(err) {
                                if (err) reject(err);
                                else resolve({ changes: this.changes });
                            }
                        );
                    }
                }
            );
        });
    }

    async incRoleWin(userId, role) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE role_stats SET wins = wins + 1 WHERE user_id = ? AND role = ?`,
                [userId, role],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    // ================= ACHIEVEMENTS =================

    async getAchievements(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT ach_id FROM achievements WHERE user_id = ?`,
                [userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(r => r.ach_id));
                }
            );
        });
    }

    async addAchievement(userId, achId) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.run(
                `INSERT OR IGNORE INTO achievements (user_id, ach_id, unlocked_at) VALUES (?, ?, ?)`,
                [userId, achId, now],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    }

    // ================= COOLDOWNS =================

    async canWork(userId) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.get(
                `SELECT work_until FROM cooldowns WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row || now >= row.work_until) {
                        this.db.run(
                            `INSERT OR REPLACE INTO cooldowns (user_id, work_until) VALUES (?, ?)`,
                            [userId, now + 3600],
                            (err) => {
                                if (err) reject(err);
                                else resolve(true);
                            }
                        );
                    } else {
                        resolve(false);
                    }
                }
            );
        });
    }

    // ================= BANK =================

    async bankDeposit(userId, amount) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.serialize(() => {
                this.db.run(`BEGIN TRANSACTION`);

                this.db.run(
                    `UPDATE users SET balance = balance - ? WHERE user_id = ?`,
                    [amount, userId]
                );

                this.db.run(
                    `INSERT OR REPLACE INTO bank (user_id, deposit, deposited_at) 
                     VALUES (?, COALESCE((SELECT deposit FROM bank WHERE user_id = ?), 0) + ?, ?)`,
                    [userId, userId, amount, now]
                );

                this.db.run(`COMMIT`, (err) => {
                    if (err) reject(err);
                    else resolve(true);
                });
            });
        });
    }

    async bankWithdraw(userId) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);

            this.db.get(
                `SELECT deposit, deposited_at FROM bank WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row || row.deposit <= 0) {
                        resolve({ success: false, message: 'Нет вклада' });
                    } else {
                        const hoursPassed = (now - row.deposited_at) / 3600;
                        if (hoursPassed < 48) {
                            resolve({ success: false, message: `До снятия ${Math.ceil(48 - hoursPassed)}ч` });
                        } else {
                            const interest = Math.floor(row.deposit * 0.16);
                            const total = row.deposit + interest;

                            this.db.serialize(() => {
                                this.db.run(`BEGIN TRANSACTION`);
                                this.db.run(`UPDATE users SET balance = balance + ? WHERE user_id = ?`, [total, userId]);
                                this.db.run(`DELETE FROM bank WHERE user_id = ?`, [userId]);
                                this.db.run(`COMMIT`, (err) => {
                                    if (err) reject(err);
                                    else resolve({ success: true, total, deposit: row.deposit, interest });
                                });
                            });
                        }
                    }
                }
            );
        });
    }

    // ================= GAME HISTORY =================

    async saveGameHistory(roomId, winnerTeam, playerCount, duration) {
        return new Promise((resolve, reject) => {
            const now = Math.floor(Date.now() / 1000);
            this.db.run(
                `INSERT INTO game_history (room_id, winner_team, player_count, duration, played_at) 
                 VALUES (?, ?, ?, ?, ?)`,
                [roomId, winnerTeam, playerCount, duration, now],
                function(err) {
                    if (err) reject(err);
                    else resolve({ gameId: this.lastID });
                }
            );
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = { Database };
