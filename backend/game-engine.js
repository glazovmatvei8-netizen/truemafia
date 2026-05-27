/**
 * Game Engine
 * Core game logic ported from Python VK bot
 */

const { BotAI } = require('./bot-ai');

const ROLE_DESCRIPTIONS = {
    "Мирный": "👨‍🌾 Обычный житель. Спит ночью, голосует днем. Побеждает если мафия уничтожена.",
    "Мафия": "🔪 Член банды. Ночью выбирает жертву с Доном. Побеждает если мафии >= мирных.",
    "Дон": "👑 Глава мафии. Ночью узнает кто Комиссар. Руководит мафией.",
    "Комиссар": "🕵️‍♂️ Шериф. Ночью проверяет игрока: мафия или мирный.",
    "Доктор": "🏥 Спасает одного игрока от смерти каждую ночь. Может лечить себя.",
    "Путана": "💋 Блокирует ночной ход выбранного игрока. Если посетит Маньяка — погибнет.",
    "Маньяк": "🔪🎭 Убивает одного игрока ночью. Играет сам за себя. Побеждает если останется один.",
    "Бомж": "🧙‍♂️ Спит на кладбище. Если его посещают ночью — узнает кто это был.",
    "Телохранитель": "🛡 Защищает игрока. Если на цель нападут — убьет нападавшего, но погибнет сам.",
    "Адвокат": "⚖ Защищает игрока от казни днем. Если город казнит защищенного — Адвокат погибнет."
};

const ROLE_EMOJIS = {
    "Мирный": "👨‍🌾", "Мафия": "🔪", "Дон": "👑", "Комиссар": "🕵️‍♂️",
    "Доктор": "🏥", "Путана": "💋", "Маньяк": "🔪🎭", "Бомж": "🧙‍♂️",
    "Телохранитель": "🛡", "Адвокат": "⚖"
};

function getTeam(role) {
    if (["Мафия", "Дон"].includes(role)) return "mafia";
    if (role === "Маньяк") return "neutral";
    return "civilian";
}

function getRolesPool(count, mode = "classic") {
    if (count < 4) {
        return ["Мафия", ...Array(count - 1).fill("Мирный")];
    }

    const pools = {
        4: ["Мафия", "Комиссар", "Доктор", "Мирный"],
        5: ["Мафия", "Дон", "Комиссар", "Доктор", "Мирный"],
        6: ["Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Мирный"],
        7: ["Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Мирный"],
        8: ["Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Мирный"],
        9: ["Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Бомж", "Мирный"],
        10: ["Мафия", "Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Бомж", "Мирный"],
        11: ["Мафия", "Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Бомж", "Телохранитель", "Мирный"],
        12: ["Мафия", "Мафия", "Мафия", "Дон", "Комиссар", "Доктор", "Путана", "Маньяк", "Бомж", "Телохранитель", "Адвокат", "Мирный"]
    };

    const sizes = Object.keys(pools).map(Number).sort((a, b) => b - a);
    for (const size of sizes) {
        if (count >= size) return pools[size];
    }
    return Array(count).fill("Мирный");
}

class GameEngine {
    constructor(roomId, io) {
        this.roomId = roomId;
        this.io = io;
        this.state = 'registration'; // registration, active, ended
        this.phase = 'registration'; // registration, night, morning, day, vote, defense, judgement, ended
        this.players = new Map();
        this.round = 0;
        this.maxPlayers = 12;
        this.minPlayers = 4;
        this.regTime = 60;
        this.nightTime = 60;
        this.dayTime = 120;
        this.voteTime = 30;
        this.defenseTime = 30;
        this.showRoles = true;
        this.mode = 'classic';

        // Night action tracking
        this.nightActions = new Map(); // playerId -> { action, targetId }
        this.blocked = new Set();
        this.healed = new Set();
        this.protected = new Map(); // targetId -> bodyguardId
        this.visitedBy = new Map(); // targetId -> [visitorIds]

        // Voting
        this.votes = new Map(); // voterId -> targetId
        this.skipVotes = new Set();
        this.defenseVotes = new Map(); // voterId -> 'guilty' | 'innocent'
        this.nominated = null;

        // Timers
        this.timer = null;
        this.phaseEndTime = null;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
    }

    addPlayer(player) {
        this.players.set(player.id, {
            ...player,
            alive: true,
            role: null,
            team: null,
            target: null,
            votedFor: null,
            blockedBy: null,
            healedBy: null,
            protectedBy: null,
            visitedBy: [],
            connected: true
        });
        this.lastActivity = Date.now();
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.lastActivity = Date.now();
    }

    fillWithBots() {
        const currentCount = this.players.size;
        const needed = this.maxPlayers - currentCount;

        for (let i = 0; i < needed; i++) {
            const botId = `bot_${Date.now()}_${i}`;
            const botNames = [
                "Антон Иванов", "Михаил Петров", "Дмитрий Сидоров",
                "Алексей Кузнецов", "Иван Смирнов", "Мария Попова",
                "Анна Васильева", "Елена Соколова", "Ольга Михайлова"
            ];

            const bot = {
                id: botId,
                socketId: null,
                name: botNames[Math.floor(Math.random() * botNames.length)],
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${botId}`,
                isBot: true,
                alive: true,
                connected: false
            };

            this.addPlayer(bot);
        }
    }

    async start() {
        this.state = 'active';
        this.lastActivity = Date.now();

        // Distribute roles
        const playerIds = Array.from(this.players.keys());
        const rolesPool = getRolesPool(playerIds.length, this.mode);

        // Shuffle
        for (let i = rolesPool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
        }

        // Collect mafia members for team reveal
        const mafiaMembers = [];
        let donId = null;

        playerIds.forEach((id, index) => {
            const player = this.players.get(id);
            const role = rolesPool[index];
            player.role = role;
            player.team = getTeam(role);

            if (["Мафия", "Дон"].includes(role)) {
                mafiaMembers.push({ id, role, name: player.name });
                if (role === "Дон") donId = id;
            }

            // Initialize bot AI
            if (player.isBot) {
                player.bot = new BotAI(player);
                player.bot.initGame(role, player.team, this);
            }
        });

        // Send roles to players
        for (const [id, player] of this.players) {
            if (player.isBot) continue;

            const socket = this.io.sockets.sockets.get(player.socketId);
            if (!socket) continue;

            socket.emit('role_assigned', {
                role: player.role,
                description: ROLE_DESCRIPTIONS[player.role],
                team: player.team,
                emoji: ROLE_EMOJIS[player.role]
            });

            // Send mafia team info
            if (["Мафия", "Дон"].includes(player.role) && mafiaMembers.length > 1) {
                const allies = mafiaMembers
                    .filter(m => m.id !== id)
                    .map(m => ({
                        id: m.id,
                        name: m.name,
                        role: m.role,
                        roleEmoji: ROLE_EMOJIS[m.role]
                    }));

                socket.emit('mafia_allies', { allies });
            }
        }

        // Notify everyone game is starting
        this.io.to(this.roomId).emit('game_starting', {
            playerCount: this.players.size,
            round: 1
        });

        // Start first day after delay
        setTimeout(() => {
            this.round = 1;
            this.startDay();
        }, 5000);
    }

    // ================= PHASE MANAGEMENT =================

    startNight() {
        this.phase = 'night';
        this.nightActions.clear();
        this.blocked.clear();
        this.healed.clear();
        this.protected.clear();
        this.visitedBy.clear();

        // Reset player targets
        for (const player of this.players.values()) {
            player.target = null;
            player.blockedBy = null;
            player.healedBy = null;
            player.protectedBy = null;
            player.visitedBy = [];
        }

        // Send night action requests
        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);

        for (const player of alivePlayers) {
            if (player.isBot) {
                // Bot makes its move
                const action = this._getBotNightAction(player);
                if (action) {
                    setTimeout(() => {
                        this.handleNightAction(player.id, action.action, action.targetId);
                    }, Math.random() * this.nightTime * 500);
                }
                continue;
            }

            const socket = this.io.sockets.sockets.get(player.socketId);
            if (!socket) continue;

            const actionMap = {
                "Мафия": "m_kill",
                "Дон": "m_kill",
                "Доктор": "d_heal",
                "Комиссар": "c_check",
                "Путана": "p_block",
                "Маньяк": "maniac_kill",
                "Телохранитель": "t_protect"
            };

            const action = actionMap[player.role];
            if (action) {
                const targets = alivePlayers
                    .filter(p => p.id !== player.id)
                    .map(p => ({
                        id: p.id,
                        name: p.name,
                        avatar: p.avatar
                    }));

                socket.emit('night_action_request', {
                    action,
                    targets
                });
            } else {
                socket.emit('system_message', { text: '😴 Вы мирный житель. Спите крепко...' });
            }
        }

        this._broadcastPhase('night');
        this._startPhaseTimer(this.nightTime, () => this.endNight());
    }

    endNight() {
        // Process night actions in order:
        // 1. Путана (blocks)
        // 2. Мафия (kills)
        // 3. Доктор (heals)
        // 4. Телохранитель (protects)
        // 5. Маньяк (kills)
        // 6. Комиссар (checks)
        // 7. Дон (finds commissar)
        // 8. Бомж (sees visitors)

        const killed = new Set();
        const results = [];

        // 1. Путана blocks
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Путана" && action.targetId) {
                const target = this.players.get(action.targetId);
                if (target?.alive) {
                    this.blocked.add(action.targetId);
                    target.blockedBy = actorId;

                    // Путана dies if visits Маньяк
                    if (target.role === "Маньяк") {
                        actor.alive = false;
                        killed.add(actorId);
                        results.push({
                            type: 'death',
                            playerId: actorId,
                            reason: 'Посетила Маньяка',
                            role: actor.role
                        });
                    }
                }
            }
        }

        // 2. Мафия kills
        const mafiaTargets = {};
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (["Мафия", "Дон"].includes(actor?.role) && !this.blocked.has(actorId)) {
                if (action.targetId) {
                    mafiaTargets[action.targetId] = (mafiaTargets[action.targetId] || 0) + 1;
                }
            }
        }

        let mafiaVictim = null;
        if (Object.keys(mafiaTargets).length > 0) {
            mafiaVictim = Object.entries(mafiaTargets)
                .sort((a, b) => b[1] - a[1])[0][0];
        }

        // 3. Доктор heals
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Доктор" && !this.blocked.has(actorId)) {
                if (action.targetId) {
                    this.healed.add(action.targetId);
                    const target = this.players.get(action.targetId);
                    if (target) target.healedBy = actorId;
                }
            }
        }

        // 4. Телохранитель protects
        let bodyguardKilled = false;
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Телохранитель" && !this.blocked.has(actorId)) {
                if (action.targetId) {
                    this.protected.set(action.targetId, actorId);
                    const target = this.players.get(action.targetId);
                    if (target) target.protectedBy = actorId;

                    // If target is mafia victim, bodyguard dies instead
                    if (action.targetId === mafiaVictim) {
                        actor.alive = false;
                        killed.add(actorId);
                        bodyguardKilled = true;
                        results.push({
                            type: 'death',
                            playerId: actorId,
                            reason: 'Погиб защищая подопечного',
                            role: actor.role
                        });
                    }
                }
            }
        }

        // 5. Маньяк kills
        let maniacVictim = null;
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Маньяк" && !this.blocked.has(actorId)) {
                if (action.targetId && !killed.has(action.targetId)) {
                    maniacVictim = action.targetId;
                }
            }
        }

        // Resolve deaths
        if (mafiaVictim && !this.healed.has(mafiaVictim) && !killed.has(mafiaVictim) && !bodyguardKilled) {
            const victim = this.players.get(mafiaVictim);
            if (victim) {
                victim.alive = false;
                killed.add(mafiaVictim);
                results.push({
                    type: 'death',
                    playerId: mafiaVictim,
                    reason: 'Убит мафией',
                    role: victim.role
                });
            }
        }

        if (maniacVictim && !this.healed.has(maniacVictim) && !killed.has(maniacVictim)) {
            const victim = this.players.get(maniacVictim);
            if (victim) {
                victim.alive = false;
                killed.add(maniacVictim);
                results.push({
                    type: 'death',
                    playerId: maniacVictim,
                    reason: 'Убит Маньяком',
                    role: victim.role
                });
            }
        }

        // 6. Комиссар checks
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Комиссар" && !this.blocked.has(actorId)) {
                if (action.targetId) {
                    const target = this.players.get(action.targetId);
                    const isMafia = ["Мафия", "Дон"].includes(target?.role);

                    if (!actor.isBot) {
                        const socket = this.io.sockets.sockets.get(actor.socketId);
                        socket?.emit('system_message', {
                            text: `🕵️‍♂️ Результат проверки ${target?.name}:
${isMafia ? '🔴 МАФИЯ!' : '🟢 Мирный'}`
                        });
                    }
                }
            }
        }

        // 7. Дон finds commissar
        for (const [actorId, action] of this.nightActions) {
            const actor = this.players.get(actorId);
            if (actor?.role === "Дон" && !this.blocked.has(actorId)) {
                if (action.targetId) {
                    const target = this.players.get(action.targetId);
                    const isComm = target?.role === "Комиссар";

                    if (!actor.isBot) {
                        const socket = this.io.sockets.sockets.get(actor.socketId);
                        socket?.emit('system_message', {
                            text: `👁 ${target?.name} ${isComm ? '— ✅ Комиссар!' : '— не Комиссар.'}`
                        });
                    }
                }
            }
        }

        // 8. Бомж sees visitors
        for (const [id, player] of this.players) {
            if (player.role === "Бомж" && player.alive) {
                const visitors = [];
                for (const [actorId, action] of this.nightActions) {
                    if (action.targetId === id && actorId !== id) {
                        const visitor = this.players.get(actorId);
                        if (visitor) visitors.push(visitor.name);
                    }
                }

                if (visitors.length > 0 && !player.isBot) {
                    const socket = this.io.sockets.sockets.get(player.socketId);
                    socket?.emit('system_message', {
                        text: `🧙‍♂️ К вам приходили:
${visitors.join('\n')}`
                    });
                }
            }
        }

        // Send results
        this.io.to(this.roomId).emit('night_results', {
            killed: Array.from(killed).map(id => {
                const p = this.players.get(id);
                return {
                    id,
                    name: p?.name,
                    role: p?.role,
                    reason: results.find(r => r.playerId === id)?.reason
                };
            }),
            showRoles: this.showRoles,
            doctorSaved: this.healed.size > 0 && Array.from(this.healed).some(id => killed.has(id))
        });

        // Mark dead players in UI
        for (const id of killed) {
            const player = this.players.get(id);
            this.io.to(this.roomId).emit('player_died', {
                playerId: id,
                role: player?.role,
                showRole: this.showRoles
            });
        }

        // Check win conditions
        if (this._checkWin()) return;

        // Start morning
        this.phase = 'morning';
        this._broadcastPhase('morning');

        setTimeout(() => this.startDay(), 4000);
    }

    startDay() {
        this.phase = 'day';
        this.votes.clear();
        this.skipVotes.clear();
        this.defenseVotes.clear();
        this.nominated = null;

        // Reset bot day state
        for (const player of this.players.values()) {
            if (player.isBot && player.bot) {
                player.bot.onDayStart();
            }
        }

        this._broadcastPhase('day');
        this._startPhaseTimer(this.dayTime, () => this.startVote());
    }

    startVote() {
        this.phase = 'vote';
        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);

        // Bot voting
        for (const player of alivePlayers) {
            if (player.isBot && player.bot) {
                const target = player.bot.chooseVote(this);
                if (target) {
                    setTimeout(() => {
                        this.handleVote(player.id, target);
                    }, Math.random() * this.voteTime * 500);
                }
            }
        }

        this.io.to(this.roomId).emit('vote_start', {
            candidates: alivePlayers.map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                votes: 0
            })),
            timeLeft: this.voteTime
        });

        this._broadcastPhase('vote');
        this._startPhaseTimer(this.voteTime, () => this.endVote());
    }

    endVote() {
        // Count votes
        const voteCounts = {};
        for (const [voterId, targetId] of this.votes) {
            if (targetId) {
                voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
            }
        }

        if (Object.keys(voteCounts).length === 0) {
            this.io.to(this.roomId).emit('system_message', { text: '💤 Никто не проголосовал. Город не выбрал подозреваемого.' });
            this.startNight();
            return;
        }

        const maxVotes = Math.max(...Object.values(voteCounts));
        const candidates = Object.entries(voteCounts)
            .filter(([_, count]) => count === maxVotes)
            .map(([id, _]) => id);

        if (candidates.length > 1) {
            this.io.to(this.roomId).emit('system_message', { 
                text: `⚖️ Ничья между ${candidates.length} кандидатами (${maxVotes} голосов). Никто не казнен.` 
            });
            this.startNight();
            return;
        }

        this.nominated = candidates[0];
        const nominatedPlayer = this.players.get(this.nominated);

        // Check Адвокат
        for (const player of this.players.values()) {
            if (player.role === "Адвокат" && player.alive && player.target === this.nominated) {
                player.alive = false;
                this.io.to(this.roomId).emit('player_died', {
                    playerId: player.id,
                    role: player.role,
                    showRole: this.showRoles
                });
                this.io.to(this.roomId).emit('system_message', {
                    text: `⚖️ ${player.name} (Адвокат) погиб, защищая подопечного!`
                });

                if (this._checkWin()) return;
                this.startNight();
                return;
            }
        }

        this.startDefense(nominatedPlayer, maxVotes);
    }

    startDefense(nominated, voteCount) {
        this.phase = 'defense';

        this.io.to(this.roomId).emit('defense_start', {
            nominated: {
                id: nominated.id,
                name: nominated.name,
                avatar: nominated.avatar
            },
            voteCount,
            timeLeft: this.defenseTime
        });

        this._broadcastPhase('defense');
        this._startPhaseTimer(this.defenseTime, () => this.startJudgement());
    }

    startJudgement() {
        this.phase = 'judgement';

        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);

        // Bot judgement
        for (const player of alivePlayers) {
            if (player.isBot && player.bot && player.id !== this.nominated) {
                const verdict = player.bot.chooseJudgement(this);
                setTimeout(() => {
                    this.handleDefenceVote(player.id, verdict);
                }, Math.random() * 5000);
            }
        }

        this.io.to(this.roomId).emit('judgement_vote', {
            nominated: {
                id: this.nominated,
                name: this.players.get(this.nominated)?.name
            },
            timeLeft: this.voteTime
        });

        this._broadcastPhase('judgement');
        this._startPhaseTimer(this.voteTime, () => this.endJudgement());
    }

    endJudgement() {
        let guilty = 0;
        let innocent = 0;

        for (const verdict of this.defenseVotes.values()) {
            if (verdict === 'guilty') guilty++;
            else innocent++;
        }

        const nominated = this.players.get(this.nominated);

        if (guilty > innocent) {
            nominated.alive = false;

            this.io.to(this.roomId).emit('execution_result', {
                playerId: this.nominated,
                name: nominated.name,
                role: this.showRoles ? nominated.role : null,
                roleEmoji: this.showRoles ? ROLE_EMOJIS[nominated.role] : null,
                guilty,
                innocent,
                executed: true
            });

            this.io.to(this.roomId).emit('player_died', {
                playerId: this.nominated,
                role: nominated.role,
                showRole: this.showRoles
            });

            if (this._checkWin()) return;
        } else {
            this.io.to(this.roomId).emit('execution_result', {
                playerId: this.nominated,
                name: nominated.name,
                guilty,
                innocent,
                executed: false
            });
        }

        this.startNight();
    }

    // ================= ACTION HANDLERS =================

    handleNightAction(playerId, action, targetId) {
        this.nightActions.set(playerId, { action, targetId });

        const player = this.players.get(playerId);
        const target = targetId ? this.players.get(targetId) : null;

        const actionNames = {
            'm_kill': 'убить',
            'd_heal': 'вылечить',
            'c_check': 'проверить',
            'p_block': 'посетить',
            'maniac_kill': 'убить',
            't_protect': 'защитить'
        };

        if (!player?.isBot) {
            const socket = this.io.sockets.sockets.get(player.socketId);
            socket?.emit('system_message', {
                text: target 
                    ? `✅ Вы решили ${actionNames[action]} ${target.name}`
                    : '🚫 Действие пропущено'
            });
        }
    }

    handleVote(voterId, targetId) {
        this.votes.set(voterId, targetId);

        const voter = this.players.get(voterId);
        const target = this.players.get(targetId);

        this.io.to(this.roomId).emit('vote_update', {
            votes: Object.fromEntries(
                Array.from(this.votes.entries()).reduce((acc, [v, t]) => {
                    acc[t] = (acc[t] || 0) + 1;
                    return acc;
                }, {})
            ),
            voterName: voter?.name,
            targetName: target?.name
        });

        this.io.to(this.roomId).emit('system_message', {
            text: `🗳 ${voter?.name} голосует против ${target?.name}!`
        });
    }

    handleSkipVote(voterId) {
        this.votes.set(voterId, null);
        const voter = this.players.get(voterId);

        this.io.to(this.roomId).emit('system_message', {
            text: `⏭ ${voter?.name} пропускает голосование`
        });
    }

    handleDefenceVote(voterId, verdict) {
        this.defenseVotes.set(voterId, verdict);
        const voter = this.players.get(voterId);

        const emoji = verdict === 'guilty' ? '🔥' : '🕊';
        const label = verdict === 'guilty' ? 'ВИНОВЕН' : 'НЕВИНОВЕН';

        this.io.to(this.roomId).emit('system_message', {
            text: `${emoji} ${voter?.name}: ${label}!`
        });
    }

    // ================= WIN CONDITIONS =================

    _checkWin() {
        const alive = Array.from(this.players.values()).filter(p => p.alive);
        const mafiaAlive = alive.filter(p => p.team === 'mafia').length;
        const civilianAlive = alive.filter(p => p.team === 'civilian').length;
        const maniacAlive = alive.filter(p => p.team === 'neutral').length;

        let winnerTeam = null;
        let winnerName = null;
        let winners = [];

        // Maniac wins if alone
        if (maniacAlive === 1 && alive.length === 1) {
            winnerTeam = 'neutral';
            winnerName = 'Маньяк';
            winners = alive.filter(p => p.team === 'neutral');
        }
        // Mafia wins if >= civilians
        else if (mafiaAlive >= civilianAlive && mafiaAlive > 0) {
            winnerTeam = 'mafia';
            winnerName = 'Мафия';
            winners = alive.filter(p => p.team === 'mafia');
        }
        // Civilians win if no mafia and no maniac
        else if (mafiaAlive === 0 && maniacAlive === 0) {
            winnerTeam = 'civilian';
            winnerName = 'Мирные жители';
            winners = alive.filter(p => p.team === 'civilian');
        }
        else {
            return false; // Game continues
        }

        this.phase = 'ended';
        this.state = 'ended';

        // Award winners
        for (const winner of winners) {
            winner.reward = 50;
            winner.xp = 25;
        }

        this.io.to(this.roomId).emit('game_over', {
            winnerTeam,
            winnerName,
            winners: winners.map(w => ({
                id: w.id,
                name: w.name,
                avatar: w.avatar
            })),
            reward: 50,
            xp: 25
        });

        this._broadcastPhase('ended');

        // Clean up after delay
        setTimeout(() => {
            this.destroy();
        }, 30000);

        return true;
    }

    // ================= BOTS =================

    _getBotNightAction(player) {
        if (!player.bot) return null;
        return player.bot.chooseTarget(this, this._getActionForRole(player.role));
    }

    _getActionForRole(role) {
        const map = {
            "Мафия": "m_kill", "Дон": "m_kill",
            "Доктор": "d_heal", "Комиссар": "c_check",
            "Путана": "p_block", "Маньяк": "maniac_kill",
            "Телохранитель": "t_protect"
        };
        return map[role] || null;
    }

    // ================= UTILS =================

    _broadcastPhase(phase) {
        this.io.to(this.roomId).emit('phase_change', {
            phase,
            round: this.round,
            timeLeft: this.getTimeLeft()
        });
    }

    _startPhaseTimer(seconds, onComplete) {
        if (this.timer) clearTimeout(this.timer);
        this.phaseEndTime = Date.now() + seconds * 1000;
        this.timer = setTimeout(onComplete, seconds * 1000);
    }

    getTimeLeft() {
        if (!this.phaseEndTime) return 0;
        return Math.max(0, Math.floor((this.phaseEndTime - Date.now()) / 1000));
    }

    isStale() {
        const inactiveTime = Date.now() - this.lastActivity;
        return inactiveTime > 300000; // 5 minutes
    }

    destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.players.clear();
    }
}

module.exports = { GameEngine, getTeam, getRolesPool, ROLE_DESCRIPTIONS, ROLE_EMOJIS };
