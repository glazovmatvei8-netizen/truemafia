/**
 * WebSocket Client for TrueMafia
 * Handles real-time connection, reconnection, and message routing
 */

class MafiaSocket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.listeners = new Map();
        this.playerId = null;
        this.roomId = null;
    }

    connect(url = window.location.origin) {
        const wsUrl = url.replace(/^http/, 'ws');

        try {
            this.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: false, // We handle reconnection manually
                timeout: 10000
            });

            this._setupListeners();
        } catch (err) {
            console.error('[WS] Connection error:', err);
            this._scheduleReconnect();
        }
    }

    _setupListeners() {
        // Connection established
        this.socket.on('connect', () => {
            console.log('[WS] Connected, socket ID:', this.socket.id);
            this.connected = true;
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;

            // Restore session if we have playerId
            if (this.playerId) {
                this.emit('restore_session', { playerId: this.playerId });
            }

            this._trigger('connected', { socketId: this.socket.id });
        });

        // Disconnection
        this.socket.on('disconnect', (reason) => {
            console.log('[WS] Disconnected:', reason);
            this.connected = false;
            this._trigger('disconnected', { reason });

            if (reason !== 'io client disconnect') {
                this._scheduleReconnect();
            }
        });

        // Connection error
        this.socket.on('connect_error', (err) => {
            console.error('[WS] Connection error:', err.message);
            this._trigger('error', { message: err.message });
            this._scheduleReconnect();
        });

        // ================= GAME EVENTS =================

        // Lobby events
        this.socket.on('lobby_update', (data) => {
            this._trigger('lobbyUpdate', data);
        });

        this.socket.on('player_joined', (data) => {
            this._trigger('playerJoined', data);
            UI.showToast(`➕ ${data.name} присоединился!`);
        });

        this.socket.on('player_left', (data) => {
            this._trigger('playerLeft', data);
            UI.showToast(`➖ ${data.name} вышел`);
        });

        this.socket.on('game_starting', (data) => {
            this._trigger('gameStarting', data);
            UI.showToast('🎭 Игра начинается! Роли распределяются...', 3000);
        });

        // Role assignment
        this.socket.on('role_assigned', (data) => {
            this._trigger('roleAssigned', data);
            UI.showRoleCard(data.role, data.description, data.team);
        });

        this.socket.on('mafia_allies', (data) => {
            this._trigger('mafiaAllies', data);
            UI.showMafiaTeam(data.allies);
        });

        // Phase events
        this.socket.on('phase_change', (data) => {
            this._trigger('phaseChange', data);
            Game.handlePhaseChange(data.phase, data);
        });

        this.socket.on('night_action_request', (data) => {
            this._trigger('nightActionRequest', data);
            Game.showNightAction(data.action, data.targets);
        });

        this.socket.on('vote_start', (data) => {
            this._trigger('voteStart', data);
            Game.showVoting(data.candidates);
        });

        this.socket.on('vote_update', (data) => {
            this._trigger('voteUpdate', data);
            UI.updateVoteBars(data.votes);
        });

        this.socket.on('defense_start', (data) => {
            this._trigger('defenseStart', data);
            Game.showDefense(data.nominated, data.voteCount);
        });

        this.socket.on('judgement_vote', (data) => {
            this._trigger('judgementVote', data);
            Game.showJudgement();
        });

        // Results
        this.socket.on('night_results', (data) => {
            this._trigger('nightResults', data);
            UI.showNightResults(data);
        });

        this.socket.on('execution_result', (data) => {
            this._trigger('executionResult', data);
            UI.showExecution(data);
        });

        this.socket.on('game_over', (data) => {
            this._trigger('gameOver', data);
            UI.showGameOver(data);
        });

        // Chat
        this.socket.on('chat_message', (data) => {
            this._trigger('chatMessage', data);
            UI.addChatMessage(data);
        });

        this.socket.on('system_message', (data) => {
            this._trigger('systemMessage', data);
            UI.addSystemMessage(data.text);
        });

        // Player state
        this.socket.on('player_died', (data) => {
            this._trigger('playerDied', data);
            UI.markPlayerDead(data.playerId, data.role, data.showRole);
        });

        this.socket.on('player_revived', (data) => {
            this._trigger('playerRevived', data);
            UI.markPlayerAlive(data.playerId);
        });

        // Errors
        this.socket.on('error', (data) => {
            this._trigger('serverError', data);
            UI.showError(data.message);
        });

        this.socket.on('kicked', (data) => {
            this._trigger('kicked', data);
            UI.showModal('Исключены', data.reason, [{ text: 'Вернуться в лобби', action: 'leave' }]);
        });
    }

    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WS] Max reconnect attempts reached');
            this._trigger('reconnectFailed', {});
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);

        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (!this.connected) {
                this.socket.connect();
            }
        }, delay);
    }

    // ================= EMIT METHODS =================

    emit(event, data = {}) {
        if (!this.connected) {
            console.warn('[WS] Not connected, queuing:', event);
            return false;
        }
        this.socket.emit(event, data);
        return true;
    }

    // Lobby actions
    joinLobby(roomId, playerName) {
        this.roomId = roomId;
        return this.emit('join_lobby', { roomId, playerName });
    }

    leaveLobby() {
        return this.emit('leave_lobby', { roomId: this.roomId });
    }

    startGame() {
        return this.emit('start_game', { roomId: this.roomId });
    }

    // Game actions
    nightAction(action, targetId) {
        return this.emit('night_action', { roomId: this.roomId, action, targetId });
    }

    vote(targetId) {
        return this.emit('vote', { roomId: this.roomId, targetId });
    }

    skipVote() {
        return this.emit('skip_vote', { roomId: this.roomId });
    }

    defenceVote(verdict) {
        return this.emit('defence_vote', { roomId: this.roomId, verdict });
    }

    // Chat
    sendChat(text) {
        return this.emit('chat', { roomId: this.roomId, text });
    }

    // ================= EVENT SYSTEM =================

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index !== -1) callbacks.splice(index, 1);
        }
    }

    _trigger(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`[WS] Error in ${event} listener:`, err);
                }
            });
        }
    }

    // ================= UTILS =================

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
        this.connected = false;
    }

    isConnected() {
        return this.connected;
    }

    getLatency() {
        if (!this.connected) return -1;
        const start = Date.now();
        return new Promise((resolve) => {
            this.socket.emit('ping', () => {
                resolve(Date.now() - start);
            });
        });
    }
}

// Global instance
const WS = new MafiaSocket();
