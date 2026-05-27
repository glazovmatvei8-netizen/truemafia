/**
 * Game Logic Controller
 * Handles game phases, actions, and state management
 */

class GameController {
    constructor() {
        this.state = 'idle'; // idle, lobby, registration, night, day, vote, defense, morning, ended
        this.phase = null;
        this.round = 0;
        this.players = new Map();
        selfPlayer = null;
        this.role = null;
        this.team = null;
        this.isAlive = true;
        this.selectedTarget = null;
        this.votedFor = null;
        this.mafiaAllies = [];
        this.timer = null;
        this.timeLeft = 0;
        this.canAct = false;
        this.hasVoted = false;
        this.hasJudged = false;
    }

    // ================= PHASE HANDLERS =================

    handlePhaseChange(phase, data) {
        this.phase = phase;
        this.round = data.round || this.round;

        // Clear previous UI states
        UI.clearOverlays();
        UI.stopTimer();
        this.canAct = false;
        this.selectedTarget = null;
        this.votedFor = null;
        this.hasVoted = false;
        this.hasJudged = false;

        switch (phase) {
            case 'registration':
                this._handleRegistration(data);
                break;
            case 'night':
                this._handleNight(data);
                break;
            case 'morning':
                this._handleMorning(data);
                break;
            case 'day':
                this._handleDay(data);
                break;
            case 'vote':
                this._handleVote(data);
                break;
            case 'defense':
                this._handleDefense(data);
                break;
            case 'judgement':
                this._handleJudgement(data);
                break;
            case 'ended':
                this._handleEnded(data);
                break;
        }

        UI.updatePhaseIndicator(phase, this.round);
    }

    _handleRegistration(data) {
        this.state = 'registration';
        UI.showRegistration(data.players, data.maxPlayers, data.minPlayers);
        this._startTimer(data.timeLeft, () => {
            UI.showToast('⏳ Регистрация закончилась!');
        });
    }

    _handleNight(data) {
        this.state = 'night';
        UI.showNightOverlay();

        if (!this.isAlive) {
            UI.showGhostMessage('Вы мертвы. Наблюдайте за игрой...');
            return;
        }

        // Determine if player can act
        const canActRoles = ['Мафия', 'Дон', 'Доктор', 'Комиссар', 'Путана', 'Маньяк', 'Телохранитель'];
        this.canAct = canActRoles.includes(this.role);

        if (this.canAct) {
            const actionMap = {
                'Мафия': 'm_kill',
                'Дон': 'm_kill',
                'Доктор': 'd_heal',
                'Комиссар': 'c_check',
                'Путана': 'p_block',
                'Маньяк': 'maniac_kill',
                'Телохранитель': 't_protect'
            };

            const action = actionMap[this.role];
            const alivePlayers = Array.from(this.players.values()).filter(p => p.alive && p.id !== selfPlayer.id);

            setTimeout(() => {
                this.showNightAction(action, alivePlayers);
            }, 2000); // Delay for atmosphere
        } else {
            UI.showSleepMessage();
        }

        this._startTimer(data.timeLeft, () => {
            if (this.canAct && !this.selectedTarget) {
                // Auto-skip if no action taken
                WS.nightAction(this._getActionForRole(), null);
            }
        });
    }

    _handleMorning(data) {
        this.state = 'morning';
        UI.showMorningAnimation();

        if (data.killed && data.killed.length > 0) {
            setTimeout(() => {
                UI.showDeathAnnouncement(data.killed, data.showRoles);
            }, 1500);
        } else {
            setTimeout(() => {
                UI.showPeacefulMorning(data.doctorSaved);
            }, 1500);
        }
    }

    _handleDay(data) {
        this.state = 'day';
        UI.showDayOverlay();
        UI.enableChat(true);

        if (!this.isAlive) {
            UI.showGhostMessage('Вы мертвы. Наблюдайте за обсуждением...');
        }

        this._startTimer(data.timeLeft, () => {
            UI.showToast('⏳ Время обсуждения закончилось!');
        });
    }

    _handleVote(data) {
        this.state = 'vote';
        UI.showVoting(data.candidates);

        if (!this.isAlive) {
            UI.showGhostMessage('Вы мертвы и не можете голосовать.');
            return;
        }

        this._startTimer(data.timeLeft, () => {
            if (!this.votedFor) {
                WS.skipVote();
            }
        });
    }

    _handleDefense(data) {
        this.state = 'defense';
        UI.showDefense(data.nominated, data.voteCount);

        // Nominated player speaks
        if (data.nominated.id === selfPlayer.id) {
            UI.showDefensePrompt('Вы на суде! Защищайтесь...');
        }

        this._startTimer(data.timeLeft, () => {
            if (data.nominated.id === selfPlayer.id) {
                WS.sendChat('[Последнее слово на суде]');
            }
        });
    }

    _handleJudgement(data) {
        this.state = 'judgement';

        if (!this.isAlive || data.nominated.id === selfPlayer.id) {
            UI.showGhostMessage(data.nominated.id === selfPlayer.id ? 
                'Вы на суде, ждите вердикта...' : 
                'Вы мертвы и не можете судить.');
            return;
        }

        UI.showJudgement(data.nominated);

        this._startTimer(data.timeLeft, () => {
            if (!this.hasJudged) {
                WS.defenceVote('innocent'); // Default to innocent
            }
        });
    }

    _handleEnded(data) {
        this.state = 'ended';
        UI.showGameOver(data);
        UI.enableChat(false);
    }

    // ================= NIGHT ACTIONS =================

    showNightAction(action, targets) {
        const actionNames = {
            'm_kill': 'Выберите жертву',
            'd_heal': 'Кого вылечить?',
            'c_check': 'Кого проверить?',
            'p_block': 'Кого посетить?',
            'maniac_kill': 'Кого убить?',
            't_protect': 'Кого защитить?'
        };

        const actionEmojis = {
            'm_kill': '🔪',
            'd_heal': '🏥',
            'c_check': '🕵️',
            'p_block': '💋',
            'maniac_kill': '🔪🎭',
            't_protect': '🛡'
        };

        UI.showActionModal({
            title: `${actionEmojis[action]} ${actionNames[action]}`,
            targets: targets.map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar
            })),
            onSelect: (targetId) => {
                this.selectedTarget = targetId;
                WS.nightAction(action, targetId);
                UI.showToast(`✅ Действие выбрано: ${targets.find(t => t.id === targetId)?.name || 'Пропущено'}`);
                UI.closeModal();
            },
            onSkip: () => {
                this.selectedTarget = null;
                WS.nightAction(action, null);
                UI.showToast('🚫 Действие пропущено');
                UI.closeModal();
            }
        });
    }

    _getActionForRole() {
        const map = {
            'Мафия': 'm_kill', 'Дон': 'm_kill',
            'Доктор': 'd_heal', 'Комиссар': 'c_check',
            'Путана': 'p_block', 'Маньяк': 'maniac_kill',
            'Телохранитель': 't_protect'
        };
        return map[this.role] || null;
    }

    // ================= VOTING =================

    showVoting(candidates) {
        UI.showVoteModal({
            title: '🗳 ГОЛОСОВАНИЕ',
            subtitle: 'Выберите подозреваемого',
            candidates: candidates.map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                votes: p.votes || 0
            })),
            onVote: (targetId) => {
                this.votedFor = targetId;
                WS.vote(targetId);
                UI.closeModal();
            },
            onSkip: () => {
                WS.skipVote();
                UI.closeModal();
            }
        });
    }

    // ================= JUDGEMENT =================

    showJudgement(nominated) {
        UI.showJudgementModal({
            title: '⚖ СУД',
            nominated: nominated,
            onGuilty: () => {
                this.hasJudged = true;
                WS.defenceVote('guilty');
                UI.closeModal();
            },
            onInnocent: () => {
                this.hasJudged = true;
                WS.defenceVote('innocent');
                UI.closeModal();
            }
        });
    }

    // ================= PLAYER MANAGEMENT =================

    addPlayer(player) {
        this.players.set(player.id, {
            ...player,
            alive: true,
            role: null,
            votes: 0
        });
        UI.addPlayerCard(player);
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        UI.removePlayerCard(playerId);
    }

    updatePlayer(playerId, updates) {
        const player = this.players.get(playerId);
        if (player) {
            Object.assign(player, updates);
            UI.updatePlayerCard(playerId, updates);
        }
    }

    markDead(playerId, role, showRole) {
        const player = this.players.get(playerId);
        if (player) {
            player.alive = false;
            player.role = role;
            UI.markPlayerDead(playerId, role, showRole);

            if (playerId === selfPlayer.id) {
                this.isAlive = false;
                UI.showDeathScreen(role);
            }
        }
    }

    // ================= TIMER =================

    _startTimer(seconds, onComplete) {
        this.timeLeft = seconds;
        UI.startTimer(seconds, (remaining) => {
            this.timeLeft = remaining;
        }, onComplete);
    }

    // ================= CHAT =================

    sendMessage(text) {
        if (!this.isAlive && this.state !== 'ended') {
            // Dead players can only chat with other dead players
            WS.sendChat(text);
            return;
        }
        WS.sendChat(text);
    }

    // ================= UTILS =================

    isMafia() {
        return this.team === 'mafia';
    }

    isCivilian() {
        return this.team === 'civilian';
    }

    isNeutral() {
        return this.team === 'neutral';
    }

    getAlivePlayers() {
        return Array.from(this.players.values()).filter(p => p.alive);
    }

    getDeadPlayers() {
        return Array.from(this.players.values()).filter(p => !p.alive);
    }

    reset() {
        this.state = 'idle';
        this.phase = null;
        this.round = 0;
        this.players.clear();
        selfPlayer = null;
        this.role = null;
        this.team = null;
        this.isAlive = true;
        this.selectedTarget = null;
        this.votedFor = null;
        this.mafiaAllies = [];
        this.timer = null;
        this.timeLeft = 0;
        this.canAct = false;
        this.hasVoted = false;
        this.hasJudged = false;
    }
}

// Global instance
const Game = new GameController();
