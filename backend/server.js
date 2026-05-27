/**
 * Express + Socket.io Server
 * Main entry point for the Mafia game server
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameEngine } = require('./game-engine');
const { BotAI } = require('./bot-ai');
const { Database } = require('./db');
const { Auth } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 10000,
    pingInterval: 5000
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Initialize database
const db = new Database(path.join(__dirname, '../data/truemafia.db'));
db.init();

// Auth
const auth = new Auth(db);

// Game rooms
const rooms = new Map(); // roomId -> GameEngine
const playerSockets = new Map(); // socketId -> { playerId, roomId }

// ================= HTTP ROUTES =================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/game.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/profile.html'));
});

// Auth routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.register(username, password);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.login(username, password);
        res.json(result);
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
});

app.get('/api/profile/:userId', async (req, res) => {
    try {
        const profile = await db.getUserProfile(req.params.userId);
        res.json(profile);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// Leaderboard
app.get('/api/top', async (req, res) => {
    try {
        const top = await db.getTopPlayers(10);
        res.json(top);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= SOCKET.IO HANDLERS =================

io.on('connection', (socket) => {
    console.log(`[CONNECT] Socket ${socket.id} connected`);

    // ================= LOBBY =================

    socket.on('join_lobby', (data) => {
        const { roomId, playerName } = data;

        if (!rooms.has(roomId)) {
            rooms.set(roomId, new GameEngine(roomId, io));
        }

        const game = rooms.get(roomId);
        const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const player = {
            id: playerId,
            socketId: socket.id,
            name: playerName || `Игрок ${game.players.size + 1}`,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerId}`,
            isBot: false,
            alive: true
        };

        game.addPlayer(player);
        playerSockets.set(socket.id, { playerId, roomId });
        socket.join(roomId);

        // Send current lobby state
        socket.emit('lobby_update', {
            players: Array.from(game.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar
            })),
            maxPlayers: game.maxPlayers,
            minPlayers: game.minPlayers,
            state: game.state,
            timeLeft: game.getTimeLeft()
        });

        // Notify others
        socket.to(roomId).emit('player_joined', {
            id: player.id,
            name: player.name,
            avatar: player.avatar
        });

        console.log(`[LOBBY] ${player.name} joined room ${roomId}`);
    });

    socket.on('leave_lobby', () => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (game) {
            const player = game.players.get(playerId);
            game.removePlayer(playerId);

            socket.to(roomId).emit('player_left', {
                id: playerId,
                name: player?.name || 'Unknown'
            });

            // Clean up empty rooms
            if (game.players.size === 0) {
                game.destroy();
                rooms.delete(roomId);
            }
        }

        playerSockets.delete(socket.id);
        socket.leave(roomId);
    });

    // ================= GAME ACTIONS =================

    socket.on('start_game', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { roomId } = info;
        const game = rooms.get(roomId);

        if (!game || game.state !== 'registration') {
            socket.emit('error', { message: 'Нет активной регистрации' });
            return;
        }

        // Check if enough players
        const humanCount = Array.from(game.players.values()).filter(p => !p.isBot).length;
        if (humanCount < game.minPlayers) {
            socket.emit('error', { message: `Недостаточно игроков (${humanCount}/${game.minPlayers})` });
            return;
        }

        // Fill with bots
        game.fillWithBots();

        // Start game
        game.start();
    });

    socket.on('night_action', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (!game || game.phase !== 'night') {
            socket.emit('error', { message: 'Сейчас не ночь' });
            return;
        }

        game.handleNightAction(playerId, data.action, data.targetId);
    });

    socket.on('vote', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (!game || game.phase !== 'vote') {
            socket.emit('error', { message: 'Сейчас не время голосования' });
            return;
        }

        game.handleVote(playerId, data.targetId);
    });

    socket.on('skip_vote', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (game && game.phase === 'vote') {
            game.handleSkipVote(playerId);
        }
    });

    socket.on('defence_vote', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (!game || game.phase !== 'judgement') {
            socket.emit('error', { message: 'Сейчас не суд' });
            return;
        }

        game.handleDefenceVote(playerId, data.verdict);
    });

    // ================= CHAT =================

    socket.on('chat', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (!game) return;

        const player = game.players.get(playerId);
        if (!player) return;

        // Check if dead player trying to chat with alive
        if (!player.alive) {
            // Only dead players can see dead chat
            const deadPlayers = Array.from(game.players.values())
                .filter(p => !p.alive)
                .map(p => p.socketId)
                .filter(Boolean);

            deadPlayers.forEach(socketId => {
                io.to(socketId).emit('chat_message', {
                    name: player.name + ' (👻)',
                    text: data.text,
                    dead: true,
                    color: '#888'
                });
            });
            return;
        }

        // Mafia night chat
        if (game.phase === 'night' && player.team === 'mafia') {
            const mafiaMembers = Array.from(game.players.values())
                .filter(p => p.team === 'mafia')
                .map(p => p.socketId)
                .filter(Boolean);

            mafiaMembers.forEach(socketId => {
                io.to(socketId).emit('chat_message', {
                    name: player.name + ' [МАФИЯ]',
                    text: data.text,
                    color: '#ff4444'
                });
            });
            return;
        }

        // Normal chat (day only)
        if (game.phase === 'day' || game.phase === 'defence') {
            io.to(roomId).emit('chat_message', {
                name: player.name,
                text: data.text,
                color: '#fff'
            });
        }
    });

    // ================= DISCONNECT =================

    socket.on('disconnect', (reason) => {
        console.log(`[DISCONNECT] Socket ${socket.id}, reason: ${reason}`);

        const info = playerSockets.get(socket.id);
        if (!info) return;

        const { playerId, roomId } = info;
        const game = rooms.get(roomId);

        if (game) {
            // Mark player as disconnected but keep in game
            const player = game.players.get(playerId);
            if (player) {
                player.connected = false;
                player.socketId = null;

                // If game is running and player is alive, they might become a bot
                if (game.state === 'active' && player.alive) {
                    player.isBot = true;
                    player.bot = new BotAI(player);
                    player.bot.initGame(player.role, player.team, game);
                }

                socket.to(roomId).emit('system_message', {
                    text: `⚠️ ${player.name} отключился`
                });
            }

            // Clean up empty rooms after delay
            setTimeout(() => {
                const activeHumans = Array.from(game.players.values())
                    .filter(p => !p.isBot && p.connected).length;
                if (activeHumans === 0) {
                    game.destroy();
                    rooms.delete(roomId);
                }
            }, 30000);
        }

        playerSockets.delete(socket.id);
    });

    // ================= PING =================

    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback();
        }
    });
});

// ================= CLEANUP =================

setInterval(() => {
    for (const [roomId, game] of rooms.entries()) {
        if (game.isStale()) {
            console.log(`[CLEANUP] Removing stale room ${roomId}`);
            game.destroy();
            rooms.delete(roomId);
        }
    }
}, 60000); // Check every minute

// ================= START =================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║     🎭 TrueMafia Server Running 🎭    ║
    ║                                       ║
    ║   Port: ${PORT}                          ║
    ║   URL:  http://localhost:${PORT}         ║
    ╚═══════════════════════════════════════╝
    `);
});

module.exports = { app, server, io };
