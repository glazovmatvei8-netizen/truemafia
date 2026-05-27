/**
 * Authentication Module
 * JWT-based auth for the web version
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'truemafia-secret-key-change-in-production';
const JWT_EXPIRES = '7d';

class Auth {
    constructor(db) {
        this.db = db;
    }

    async register(username, password) {
        // Validate
        if (!username || username.length < 3 || username.length > 20) {
            throw new Error('Имя пользователя: 3-20 символов');
        }
        if (!password || password.length < 6) {
            throw new Error('Пароль минимум 6 символов');
        }

        // Check if exists
        const existing = await this.db.getUserByUsername(username);
        if (existing) {
            throw new Error('Это имя уже занято');
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Create user
        const result = await this.db.createUser(username, passwordHash);

        // Generate token
        const token = this._generateToken(result.userId, username);

        return {
            success: true,
            token,
            user: {
                id: result.userId,
                username
            }
        };
    }

    async login(username, password) {
        // Find user
        const user = await this.db.getUserByUsername(username);
        if (!user) {
            throw new Error('Неверное имя пользователя или пароль');
        }

        // Check password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            throw new Error('Неверное имя пользователя или пароль');
        }

        // Generate token
        const token = this._generateToken(user.user_id, user.username);

        return {
            success: true,
            token,
            user: {
                id: user.user_id,
                username: user.username,
                nickname: user.nickname,
                balance: user.balance,
                premium: user.premium
            }
        };
    }

    _generateToken(userId, username) {
        return jwt.sign(
            { userId, username },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );
    }

    verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return null;
        }
    }

    middleware() {
        return async (req, res, next) => {
            const token = req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const decoded = this.verifyToken(token);
            if (!decoded) {
                return res.status(401).json({ error: 'Недействительный токен' });
            }

            req.user = decoded;
            next();
        };
    }
}

module.exports = { Auth };
