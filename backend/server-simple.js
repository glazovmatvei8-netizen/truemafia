/**
 * Express + Socket.io Server
 * FIXED VERSION - properly serves static files
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 10000,
    pingInterval: 5000
});

// ================= STATIC FILES =================
// THIS IS THE FIX - serve frontend folder properly
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Parse JSON
app.use(express.json());

// ================= GAME LOGIC (inline for simplicity) =================

const ROLE_DESCRIPTIONS = {
    "Мирный": "👨‍🌾 Обычный житель. Спит ночью, голосует днем.",
    "Мафия": "🔪 Член банды. Ночью выбирает жертву.",
    "Дон": "👑 Глава мафии. Узнаёт Комиссара.",
    "Комиссар": "🕵️‍♂️ Проверяет игроков ночью.",
    "Доктор": "🏥 Лечит одного игрока ночью.",
    "Путана": "💋 Блокирует ход игрока.",
    "Маньяк": "🔪🎭 Убивает один на один."
};

const ROLE_EMOJIS = {
    "Мирный": "👨‍🌾", "Мафия": "🔪", "Дон": "👑", "Комиссар": "🕵️‍♂️",
    "Доктор": "🏥", "Путана": "💋", "Маньяк": "🔪🎭"
};

function getTeam(role) {
    if (["Мафия", "Дон"].includes(role)) return "mafia";
    if (role === "Маньяк") return "neutral";
    return "civilian";
}

function getRolesPool(count) {
    if (count < 4) return ["Мафия", ...Array(count-1).fill("Мирный")];
    const pools = {
        4: ["Мафия", "Комиссар", "Доктор", "Мирный"],
        5: ["Мафия", "Дон", "Комиссар", "Доктор", "Мирный"],
        6: ["Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Мирный"],
        7: ["Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Мирный"],
        8: ["Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Мирный"]
    };
    for (const size of Object.keys(pools).map(Number).sort((a,b)=>b-a)) {
        if (count >= size) return pools[size];
    }
    return Array(count).fill("Мирный");
}

class GameEngine {
    constructor(roomId, io) {
        this.roomId = roomId;
        this.io = io;
        this.state = 'registration';
        this.phase = 'registration';
        this.players = new Map();
        this.round = 0;
        this.maxPlayers = 8;
        this.minPlayers = 4;
        this.nightTime = 30;
        this.dayTime = 60;
        this.voteTime = 20;
        this.showRoles = true;

        this.nightActions = new Map();
        this.votes = new Map();
        this.timer = null;
    }

    addPlayer(player) {
        this.players.set(player.id, { ...player, alive: true, role: null, team: null, target: null, votedFor: null });
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
    }

    fillWithBots() {
        const needed = this.maxPlayers - this.players.size;
        const names = ["Антон", "Михаил", "Дмитрий", "Алексей", "Мария", "Анна", "Сергей", "Ольга"];
        for (let i = 0; i < needed; i++) {
            const botId = `bot_${Date.now()}_${i}`;
            this.addPlayer({
                id: botId,
                socketId: null,
                name: names[i % names.length] + " (бот)",
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${botId}`,
                isBot: true,
                alive: true
            });
        }
    }

    start() {
        this.state = 'active';
        const ids = Array.from(this.players.keys());
        const roles = getRolesPool(ids.length);

        // Shuffle
        for (let i = roles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [roles[i], roles[j]] = [roles[j], roles[i]];
        }

        const mafiaMembers = [];
        ids.forEach((id, i) => {
            const p = this.players.get(id);
            p.role = roles[i];
            p.team = getTeam(roles[i]);
            if (["Мафия", "Дон"].includes(p.role)) {
                mafiaMembers.push({ id, role: p.role, name: p.name });
            }
        });

        // Send roles
        for (const [id, p] of this.players) {
            if (p.isBot) continue;
            const socket = io.sockets.sockets.get(p.socketId);
            if (!socket) continue;

            socket.emit('role_assigned', {
                role: p.role,
                description: ROLE_DESCRIPTIONS[p.role],
                team: p.team,
                emoji: ROLE_EMOJIS[p.role]
            });

            if (["Мафия", "Дон"].includes(p.role) && mafiaMembers.length > 1) {
                socket.emit('mafia_allies', {
                    allies: mafiaMembers.filter(m => m.id !== id).map(m => ({
                        id: m.id, name: m.name, role: m.role, roleEmoji: ROLE_EMOJIS[m.role]
                    }))
                });
            }
        }

        this.io.to(this.roomId).emit('game_starting', { playerCount: this.players.size, round: 1 });

        setTimeout(() => {
            this.round = 1;
            this.startDay();
        }, 3000);
    }

    startDay() {
        this.phase = 'day';
        this.votes.clear();
        this._broadcastPhase('day');
        this._startTimer(this.dayTime, () => this.startVote());
    }

    startVote() {
        this.phase = 'vote';
        const alive = Array.from(this.players.values()).filter(p => p.alive);

        // Bot votes
        for (const p of alive) {
            if (p.isBot) {
                const targets = alive.filter(x => x.id !== p.id);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    setTimeout(() => this.handleVote(p.id, target.id), Math.random() * 5000);
                }
            }
        }

        this.io.to(this.roomId).emit('vote_start', {
            candidates: alive.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, votes: 0 })),
            timeLeft: this.voteTime
        });

        this._broadcastPhase('vote');
        this._startTimer(this.voteTime, () => this.endVote());
    }

    endVote() {
        const voteCounts = {};
        for (const [voter, target] of this.votes) {
            if (target) voteCounts[target] = (voteCounts[target] || 0) + 1;
        }

        if (Object.keys(voteCounts).length === 0) {
            this.io.to(this.roomId).emit('system_message', { text: '💤 Никто не проголосовал' });
            this.startNight();
            return;
        }

        const maxVotes = Math.max(...Object.values(voteCounts));
        const candidates = Object.entries(voteCounts).filter(([_,c]) => c === maxVotes).map(([id,_]) => id);

        if (candidates.length > 1) {
            this.io.to(this.roomId).emit('system_message', { text: '⚖️ Ничья! Никто не казнён.' });
            this.startNight();
            return;
        }

        const nominated = this.players.get(candidates[0]);
        nominated.alive = false;

        this.io.to(this.roomId).emit('execution_result', {
            playerId: nominated.id,
            name: nominated.name,
            role: this.showRoles ? nominated.role : null,
            roleEmoji: this.showRoles ? ROLE_EMOJIS[nominated.role] : null,
            executed: true
        });

        this.io.to(this.roomId).emit('player_died', {
            playerId: nominated.id,
            role: nominated.role,
            showRole: this.showRoles
        });

        if (this._checkWin()) return;
        this.startNight();
    }

    startNight() {
        this.phase = 'night';
        this.nightActions.clear();
        for (const p of this.players.values()) { p.target = null; }

        const alive = Array.from(this.players.values()).filter(p => p.alive);

        for (const p of alive) {
            if (p.isBot) {
                const targets = alive.filter(x => x.id !== p.id);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    setTimeout(() => this.handleNightAction(p.id, 'action', target.id), Math.random() * 10000);
                }
                continue;
            }

            const socket = io.sockets.sockets.get(p.socketId);
            if (!socket) continue;

            const actionMap = { "Мафия": "m_kill", "Дон": "m_kill", "Доктор": "d_heal", "Комиссар": "c_check", "Путана": "p_block", "Маньяк": "maniac_kill" };
            const action = actionMap[p.role];

            if (action) {
                socket.emit('night_action_request', {
                    action,
                    targets: alive.filter(x => x.id !== p.id).map(x => ({ id: x.id, name: x.name, avatar: x.avatar }))
                });
            } else {
                socket.emit('system_message', { text: '😴 Вы мирный. Спите крепко...' });
            }
        }

        this._broadcastPhase('night');
        this._startTimer(this.nightTime, () => this.endNight());
    }

    endNight() {
        const killed = new Set();
        const alive = Array.from(this.players.values()).filter(p => p.alive);

        // Simple night resolution
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (!actor || !actor.alive) continue;

            if (["Мафия", "Дон", "Маньяк"].includes(actor.role) && action.targetId) {
                const target = this.players.get(action.targetId);
                if (target && target.alive && !killed.has(target.id)) {
                    target.alive = false;
                    killed.add(target.id);
                }
            }
        }

        this.io.to(this.roomId).emit('night_results', {
            killed: Array.from(killed).map(id => {
                const p = this.players.get(id);
                return { id, name: p?.name, role: p?.role };
            }),
            showRoles: this.showRoles,
            doctorSaved: false
        });

        for (const id of killed) {
            this.io.to(this.roomId).emit('player_died', { playerId: id, role: this.players.get(id)?.role, showRole: this.showRoles });
        }

        if (this._checkWin()) return;

        this.phase = 'morning';
        this._broadcastPhase('morning');
        setTimeout(() => this.startDay(), 3000);
    }

    handleNightAction(playerId, action, targetId) {
        this.nightActions.set(playerId, { action, targetId });
    }

    handleVote(voterId, targetId) {
        this.votes.set(voterId, targetId);
        const voter = this.players.get(voterId);
        const target = this.players.get(targetId);
        this.io.to(this.roomId).emit('system_message', { text: `🗳 ${voter?.name} голосует против ${target?.name}` });
    }

    _checkWin() {
        const alive = Array.from(this.players.values()).filter(p => p.alive);
        const mafia = alive.filter(p => p.team === 'mafia').length;
        const civ = alive.filter(p => p.team === 'civilian').length;
        const maniac = alive.filter(p => p.team === 'neutral').length;

        let winner = null;
        if (maniac === 1 && alive.length === 1) winner = 'neutral';
        else if (mafia >= civ && mafia > 0) winner = 'mafia';
        else if (mafia === 0 && maniac === 0) winner = 'civilian';

        if (winner) {
            this.phase = 'ended';
            const winners = alive.filter(p => p.team === winner || (winner === 'neutral' && p.team === 'neutral'));
            this.io.to(this.roomId).emit('game_over', {
                winnerTeam: winner,
                winnerName: winner === 'mafia' ? 'Мафия' : winner === 'civilian' ? 'Мирные' : 'Маньяк',
                winners: winners.map(w => ({ id: w.id, name: w.name, avatar: w.avatar })),
                reward: 50,
                xp: 25
            });
            setTimeout(() => { this.destroy(); }, 30000);
            return true;
        }
        return false;
    }

    _broadcastPhase(phase) {
        this.io.to(this.roomId).emit('phase_change', { phase, round: this.round, timeLeft: this.nightTime || this.dayTime });
    }

    _startTimer(seconds, callback) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(callback, seconds * 1000);
    }

    destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.players.clear();
    }
}

// ================= ROOMS =================
const rooms = new Map();
const playerSockets = new Map();

// ================= SOCKET.IO =================

io.on('connection', (socket) => {
    console.log('[CONNECT]', socket.id);

    socket.on('join_lobby', (data) => {
        const { roomId, playerName } = data;

        if (!rooms.has(roomId)) {
            rooms.set(roomId, new GameEngine(roomId, io));
        }

        const game = rooms.get(roomId);
        const playerId = `p_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;

        const player = {
            id: playerId,
            socketId: socket.id,
            name: playerName || 'Игрок',
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${playerId}`,
            isBot: false,
            alive: true
        };

        game.addPlayer(player);
        playerSockets.set(socket.id, { playerId, roomId });
        socket.join(roomId);

        // Send lobby state
        socket.emit('lobby_update', {
            players: Array.from(game.players.values()).map(p => ({
                id: p.id, name: p.name, avatar: p.avatar
            })),
            maxPlayers: game.maxPlayers,
            minPlayers: game.minPlayers,
            state: game.state
        });

        socket.to(roomId).emit('player_joined', {
            id: player.id, name: player.name, avatar: player.avatar
        });

        console.log(`[LOBBY] ${player.name} -> ${roomId}`);
    });

    socket.on('start_game', () => {
        const info = playerSockets.get(socket.id);
        if (!info) return;

        const game = rooms.get(info.roomId);
        if (!game || game.state !== 'registration') {
            socket.emit('error', { message: 'Нет активной регистрации' });
            return;
        }

        const humans = Array.from(game.players.values()).filter(p => !p.isBot).length;
        if (humans < 1) {
            socket.emit('error', { message: 'Нужен хотя бы 1 игрок' });
            return;
        }

        game.fillWithBots();
        game.start();
    });

    socket.on('night_action', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;
        const game = rooms.get(info.roomId);
        if (game) game.handleNightAction(info.playerId, data.action, data.targetId);
    });

    socket.on('vote', (data) => {
        const info = playerSockets.get(socket.id);
        if (!info) return;
        const game = rooms.get(info.roomId);
        if (game) game.handleVote(info.playerId, data.targetId);
    });

    socket.on('skip_vote', () => {
        const info = playerSockets.get(socket.id);
        if (!info) return;
        const game = rooms.get(info.roomId);
        if (game) game.handleVote(info.playerId, null);
    });

    socket.on('disconnect', () => {
        console.log('[DISCONNECT]', socket.id);
        const info = playerSockets.get(socket.id);
        if (info) {
            const game = rooms.get(info.roomId);
            if (game) {
                const p = game.players.get(info.playerId);
                socket.to(info.roomId).emit('player_left', { id: info.playerId, name: p?.name || '?' });
                game.removePlayer(info.playerId);

                if (game.players.size === 0) {
                    game.destroy();
                    rooms.delete(info.roomId);
                }
            }
            playerSockets.delete(socket.id);
        }
    });
});

// ================= START =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║     🎭 TrueMafia Server Running 🎭    ║
║                                       ║
║   http://localhost:${PORT}                  ║
║                                       ║
║   Открой test.html для теста          ║
╚═══════════════════════════════════════╝
    `);
});
