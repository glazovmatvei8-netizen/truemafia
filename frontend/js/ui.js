/**
 * UI Controller
 * Handles all visual effects, animations, modals, and DOM manipulation
 */

class UIController {
    constructor() {
        this.elements = {};
        this.cacheElements();
        this.sounds = {};
        this.preloadSounds();
        this.currentModal = null;
        this.timerInterval = null;
    }

    cacheElements() {
        this.elements = {
            app: document.getElementById('app'),
            gameBoard: document.getElementById('game-board'),
            playerGrid: document.getElementById('player-grid'),
            chatBox: document.getElementById('chat-box'),
            chatMessages: document.getElementById('chat-messages'),
            chatInput: document.getElementById('chat-input'),
            phaseIndicator: document.getElementById('phase-indicator'),
            timer: document.getElementById('timer'),
            roleCard: document.getElementById('role-card'),
            modalOverlay: document.getElementById('modal-overlay'),
            modalContent: document.getElementById('modal-content'),
            toastContainer: document.getElementById('toast-container'),
            nightOverlay: document.getElementById('night-overlay'),
            dayOverlay: document.getElementById('day-overlay'),
            deathOverlay: document.getElementById('death-overlay')
        };
    }

    // ================= SOUNDS =================

    preloadSounds() {
        const soundFiles = {
            night: '/assets/sounds/night.mp3',
            day: '/assets/sounds/day.mp3',
            death: '/assets/sounds/death.mp3',
            win: '/assets/sounds/win.mp3',
            lose: '/assets/sounds/lose.mp3',
            vote: '/assets/sounds/vote.mp3',
            message: '/assets/sounds/message.mp3',
            tick: '/assets/sounds/tick.mp3'
        };

        for (const [name, path] of Object.entries(soundFiles)) {
            this.sounds[name] = new Audio(path);
            this.sounds[name].preload = 'auto';
        }
    }

    playSound(name) {
        const sound = this.sounds[name];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {}); // Ignore autoplay restrictions
        }
    }

    // ================= PHASE VISUALS =================

    showNightOverlay() {
        this.playSound('night');
        const overlay = this.elements.nightOverlay;
        overlay.classList.add('active');
        overlay.innerHTML = `
            <div class="night-content">
                <div class="moon">🌙</div>
                <h2>НОЧЬ #${Game.round}</h2>
                <p>Город засыпает... Мафия просыпается</p>
                <div class="stars"></div>
            </div>
        `;
        this._generateStars(overlay.querySelector('.stars'));

        setTimeout(() => {
            overlay.classList.remove('active');
        }, 3000);
    }

    showDayOverlay() {
        this.playSound('day');
        const overlay = this.elements.dayOverlay;
        overlay.classList.add('active');
        overlay.innerHTML = `
            <div class="day-content">
                <div class="sun">☀️</div>
                <h2>ДЕНЬ #${Game.round}</h2>
                <p>Город просыпается... Обсуждайте!</p>
            </div>
        `;

        setTimeout(() => {
            overlay.classList.remove('active');
        }, 2000);
    }

    showMorningAnimation() {
        this.elements.app.classList.add('morning-glow');
        setTimeout(() => {
            this.elements.app.classList.remove('morning-glow');
        }, 2000);
    }

    _generateStars(container) {
        for (let i = 0; i < 50; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.animationDelay = Math.random() * 3 + 's';
            container.appendChild(star);
        }
    }

    // ================= ROLE CARD =================

    showRoleCard(role, description, team) {
        this.playSound('message');
        const roleEmojis = {
            'Мирный': '👨‍🌾', 'Мафия': '🔪', 'Дон': '👑',
            'Комиссар': '🕵️‍♂️', 'Доктор': '🏥', 'Путана': '💋',
            'Маньяк': '🔪🎭', 'Бомж': '🧙‍♂️', 'Телохранитель': '🛡',
            'Адвокат': '⚖'
        };

        const teamColors = {
            'mafia': '#ff4444',
            'civilian': '#44ff44',
            'neutral': '#ffaa00'
        };

        const card = this.elements.roleCard;
        card.innerHTML = `
            <div class="role-reveal">
                <div class="role-emoji">${roleEmojis[role] || '👤'}</div>
                <h2>${role}</h2>
                <p class="role-desc">${description}</p>
                <div class="role-team" style="color: ${teamColors[team]}">
                    ${team === 'mafia' ? '🔴 Мафия' : team === 'neutral' ? '🟠 Нейтрал' : '🟢 Мирный'}
                </div>
                <button class="btn-primary" onclick="UI.hideRoleCard()">Понятно</button>
            </div>
        `;
        card.classList.add('active');
    }

    hideRoleCard() {
        this.elements.roleCard.classList.remove('active');
    }

    showMafiaTeam(allies) {
        const modal = document.createElement('div');
        modal.className = 'modal mafia-team-modal';
        modal.innerHTML = `
            <h2>🦅 ВАША БАНДА</h2>
            <div class="mafia-allies">
                ${allies.map(a => `
                    <div class="ally-card">
                        <span class="ally-role">${a.roleEmoji}</span>
                        <span class="ally-name">${a.name}</span>
                    </div>
                `).join('')}
            </div>
            <p class="hint">💬 Ночью пишите в чат для связи с бандой!</p>
            <button class="btn-primary" onclick="this.closest('.modal').remove()">Понятно</button>
        `;
        this.showModalElement(modal);
    }

    // ================= PLAYER CARDS =================

    addPlayerCard(player) {
        const grid = this.elements.playerGrid;
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-${player.id}`;
        card.dataset.playerId = player.id;
        card.innerHTML = `
            <div class="player-avatar">
                <img src="${player.avatar || '/assets/roles/default.png'}" alt="${player.name}">
                <div class="player-status"></div>
            </div>
            <div class="player-info">
                <span class="player-name">${player.name}</span>
                <span class="player-role hidden">?</span>
            </div>
            <div class="player-votes"></div>
        `;
        grid.appendChild(card);
    }

    removePlayerCard(playerId) {
        const card = document.getElementById(`player-${playerId}`);
        if (card) {
            card.style.transform = 'scale(0)';
            setTimeout(() => card.remove(), 300);
        }
    }

    updatePlayerCard(playerId, updates) {
        const card = document.getElementById(`player-${playerId}`);
        if (!card) return;

        if (updates.name) {
            card.querySelector('.player-name').textContent = updates.name;
        }
        if (updates.avatar) {
            card.querySelector('.player-avatar img').src = updates.avatar;
        }
        if (updates.votes !== undefined) {
            const votesEl = card.querySelector('.player-votes');
            votesEl.textContent = updates.votes > 0 ? `🗳 ${updates.votes}` : '';
        }
    }

    markPlayerDead(playerId, role, showRole) {
        const card = document.getElementById(`player-${playerId}`);
        if (!card) return;

        card.classList.add('dead');
        const roleEl = card.querySelector('.player-role');

        if (showRole) {
            const roleEmojis = {
                'Мирный': '👨‍🌾', 'Мафия': '🔪', 'Дон': '👑',
                'Комиссар': '🕵️‍♂️', 'Доктор': '🏥', 'Путана': '💋',
                'Маньяк': '🔪🎭', 'Бомж': '🧙‍♂️', 'Телохранитель': '🛡',
                'Адвокат': '⚖'
            };
            roleEl.textContent = roleEmojis[role] || '💀';
            roleEl.classList.remove('hidden');
        } else {
            roleEl.textContent = '💀';
            roleEl.classList.remove('hidden');
        }

        // Death animation
        card.style.animation = 'deathPulse 1s ease';
        this.playSound('death');
    }

    markPlayerAlive(playerId) {
        const card = document.getElementById(`player-${playerId}`);
        if (card) {
            card.classList.remove('dead');
            card.querySelector('.player-role').classList.add('hidden');
        }
    }

    // ================= VOTING UI =================

    updateVoteBars(votes) {
        for (const [playerId, count] of Object.entries(votes)) {
            const card = document.getElementById(`player-${playerId}`);
            if (card) {
                const votesEl = card.querySelector('.player-votes');
                votesEl.textContent = count > 0 ? `🗳 ${count}` : '';

                // Scale animation
                if (count > 0) {
                    card.style.transform = 'scale(1.05)';
                    setTimeout(() => card.style.transform = 'scale(1)', 200);
                }
            }
        }
    }

    showVoteModal(options) {
        const content = document.createElement('div');
        content.className = 'vote-modal-content';
        content.innerHTML = `
            <h2>${options.title}</h2>
            <p class="subtitle">${options.subtitle}</p>
            <div class="candidates-grid">
                ${options.candidates.map(c => `
                    <button class="candidate-btn" data-id="${c.id}">
                        <img src="${c.avatar}" alt="${c.name}">
                        <span>${c.name}</span>
                        <span class="vote-count">${c.votes > 0 ? c.votes + ' 🗳' : ''}</span>
                    </button>
                `).join('')}
            </div>
            <button class="btn-secondary skip-btn">⏭ Пропустить</button>
        `;

        content.querySelectorAll('.candidate-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                options.onSelect(parseInt(btn.dataset.id));
            });
        });

        content.querySelector('.skip-btn').addEventListener('click', options.onSkip);

        this.showModalElement(content);
    }

    showJudgementModal(options) {
        const content = document.createElement('div');
        content.className = 'judgement-modal-content';
        content.innerHTML = `
            <h2>${options.title}</h2>
            <div class="nominated-display">
                <img src="${options.nominated.avatar}" alt="${options.nominated.name}">
                <span class="nominated-name">${options.nominated.name}</span>
            </div>
            <p class="question">Виновен или невиновен?</p>
            <div class="judgement-buttons">
                <button class="btn-guilty">
                    <span class="emoji">🔥</span>
                    <span>ВИНОВЕН</span>
                </button>
                <button class="btn-innocent">
                    <span class="emoji">🕊</span>
                    <span>НЕВИНОВЕН</span>
                </button>
            </div>
        `;

        content.querySelector('.btn-guilty').addEventListener('click', options.onGuilty);
        content.querySelector('.btn-innocent').addEventListener('click', options.onInnocent);

        this.showModalElement(content);
    }

    showActionModal(options) {
        const content = document.createElement('div');
        content.className = 'action-modal-content';
        content.innerHTML = `
            <h2>${options.title}</h2>
            <div class="targets-grid">
                ${options.targets.map(t => `
                    <button class="target-btn" data-id="${t.id}">
                        <img src="${t.avatar}" alt="${t.name}">
                        <span>${t.name}</span>
                    </button>
                `).join('')}
            </div>
            <button class="btn-secondary skip-btn">🚫 Пропустить</button>
        `;

        content.querySelectorAll('.target-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                options.onSelect(parseInt(btn.dataset.id));
            });
        });

        content.querySelector('.skip-btn').addEventListener('click', options.onSkip);

        this.showModalElement(content);
    }

    // ================= DEATH & RESULTS =================

    showDeathScreen(role) {
        this.playSound('lose');
        const overlay = this.elements.deathOverlay;
        overlay.innerHTML = `
            <div class="death-content">
                <div class="skull">💀</div>
                <h2>ВЫ ПОГИБЛИ</h2>
                <p>Ваша роль: ${role}</p>
                <p class="hint">Вы можете наблюдать за игрой, но не участвовать</p>
            </div>
        `;
        overlay.classList.add('active');

        setTimeout(() => {
            overlay.classList.remove('active');
        }, 4000);
    }

    showDeathAnnouncement(killed, showRoles) {
        const modal = document.createElement('div');
        modal.className = 'modal death-announcement';

        const victims = killed.map(v => {
            const roleEmoji = showRoles ? ({
                'Мирный': '👨‍🌾', 'Мафия': '🔪', 'Дон': '👑',
                'Комиссар': '🕵️‍♂️', 'Доктор': '🏥', 'Путана': '💋',
                'Маньяк': '🔪🎭', 'Бомж': '🧙‍♂️', 'Телохранитель': '🛡',
                'Адвокат': '⚖'
            }[v.role] || '💀') : '💀';

            return `<div class="victim">
                <span class="victim-emoji">${roleEmoji}</span>
                <span class="victim-name">${v.name}</span>
                ${showRoles ? `<span class="victim-role">${v.role}</span>` : ''}
            </div>`;
        }).join('');

        modal.innerHTML = `
            <h2>📰 НОВОСТИ УТРА</h2>
            <div class="victims-list">
                ${victims}
            </div>
            <p class="death-count">${killed.length} жертв</p>
        `;

        this.playSound('death');
        this.showModalElement(modal);

        setTimeout(() => this.closeModal(), 4000);
    }

    showPeacefulMorning(doctorSaved) {
        const modal = document.createElement('div');
        modal.className = 'modal peaceful-morning';
        modal.innerHTML = `
            <h2>🕊️ Спокойная ночь</h2>
            <p>Никто не пострадал${doctorSaved ? '
🏥 Доктор кого-то спас...' : ''}</p>
        `;
        this.showModalElement(modal);
        setTimeout(() => this.closeModal(), 3000);
    }

    showGameOver(data) {
        this.playSound(data.won ? 'win' : 'lose');

        const teamEmojis = {
            'mafia': '🔪',
            'civilian': '🕊️',
            'neutral': '🔪🎭'
        };

        const modal = document.createElement('div');
        modal.className = 'modal game-over';
        modal.innerHTML = `
            <h2>🎭 ИГРА ОКОНЧЕНА 🎭</h2>
            <div class="winner-team">
                <span class="team-emoji">${teamEmojis[data.winnerTeam]}</span>
                <span class="team-name">${data.winnerName} победили!</span>
            </div>
            <div class="winners-list">
                ${data.winners.map(w => `
                    <div class="winner">
                        <img src="${w.avatar}" alt="${w.name}">
                        <span>${w.name}</span>
                    </div>
                `).join('')}
            </div>
            <div class="rewards">
                <p>💰 +${data.reward} монет</p>
                <p>✨ +${data.xp} XP</p>
            </div>
            <button class="btn-primary" onclick="location.reload()">Новая игра</button>
        `;
        this.showModalElement(modal);
    }

    // ================= CHAT =================

    addChatMessage(data) {
        const messages = this.elements.chatMessages;
        const msg = document.createElement('div');
        msg.className = `chat-message ${data.system ? 'system' : ''} ${data.dead ? 'dead-chat' : ''}`;

        if (data.system) {
            msg.innerHTML = `<span class="system-text">${data.text}</span>`;
        } else {
            msg.innerHTML = `
                <span class="msg-author" style="color: ${data.color || '#fff'}">${data.name}</span>
                <span class="msg-text">${this._escapeHtml(data.text)}</span>
            `;
        }

        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;

        if (!data.system) {
            this.playSound('message');
        }
    }

    addSystemMessage(text) {
        this.addChatMessage({ system: true, text });
    }

    enableChat(enabled) {
        this.elements.chatInput.disabled = !enabled;
        if (!enabled) {
            this.elements.chatInput.placeholder = 'Чат недоступен...';
        } else {
            this.elements.chatInput.placeholder = 'Напишите сообщение...';
        }
    }

    showGhostMessage(text) {
        const overlay = document.createElement('div');
        overlay.className = 'ghost-overlay';
        overlay.innerHTML = `
            <div class="ghost">👻</div>
            <p>${text}</p>
        `;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 3000);
    }

    showSleepMessage() {
        const overlay = document.createElement('div');
        overlay.className = 'sleep-overlay';
        overlay.innerHTML = `
            <div class="zzz">😴 💤 💤 💤</div>
            <p>Вы мирный житель. Спите крепко...</p>
        `;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 3000);
    }

    showDefensePrompt(text) {
        const banner = document.createElement('div');
        banner.className = 'defense-banner';
        banner.innerHTML = `
            <span class="gavel">⚖️</span>
            <span>${text}</span>
        `;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 5000);
    }

    // ================= TIMER =================

    startTimer(seconds, onTick, onComplete) {
        this.stopTimer();
        let remaining = seconds;

        const timerEl = this.elements.timer;
        timerEl.classList.add('active');

        this.timerInterval = setInterval(() => {
            remaining--;

            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

            // Warning colors
            if (remaining <= 10) {
                timerEl.classList.add('urgent');
                this.playSound('tick');
            } else if (remaining <= 30) {
                timerEl.classList.add('warning');
            }

            onTick(remaining);

            if (remaining <= 0) {
                this.stopTimer();
                onComplete();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.elements.timer.classList.remove('active', 'warning', 'urgent');
    }

    // ================= MODALS =================

    showModalElement(content) {
        this.closeModal();
        this.currentModal = content;
        this.elements.modalContent.innerHTML = '';
        this.elements.modalContent.appendChild(content);
        this.elements.modalOverlay.classList.add('active');
    }

    showModal(title, text, buttons) {
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = `
            <h2>${title}</h2>
            <p>${text}</p>
            <div class="modal-buttons">
                ${buttons.map(b => `
                    <button class="btn-${b.type || 'primary'}" data-action="${b.action}">${b.text}</button>
                `).join('')}
            </div>
        `;

        content.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'leave') {
                    location.href = '/';
                }
                this.closeModal();
            });
        });

        this.showModalElement(content);
    }

    closeModal() {
        this.elements.modalOverlay.classList.remove('active');
        this.currentModal = null;
    }

    // ================= TOASTS =================

    showToast(message, duration = 2000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        this.elements.toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    showError(message) {
        this.showToast(`❌ ${message}`, 3000);
    }

    // ================= REGISTRATION =================

    showRegistration(players, maxPlayers, minPlayers) {
        const content = document.createElement('div');
        content.className = 'registration-lobby';
        content.innerHTML = `
            <h2>🎭 НАБОР В МАФИЮ</h2>
            <div class="lobby-counter">
                <span class="count">${players.length}</span>
                <span class="separator">/</span>
                <span class="max">${maxPlayers}</span>
            </div>
            <div class="lobby-players">
                ${players.map(p => `
                    <div class="lobby-player">
                        <img src="${p.avatar}" alt="${p.name}">
                        <span>${p.name}</span>
                    </div>
                `).join('')}
            </div>
            <p class="min-info">Минимум игроков: ${minPlayers}</p>
        `;

        this.elements.gameBoard.innerHTML = '';
        this.elements.gameBoard.appendChild(content);
    }

    // ================= PHASE INDICATOR =================

    updatePhaseIndicator(phase, round) {
        const indicator = this.elements.phaseIndicator;
        const phaseNames = {
            'registration': 'РЕГИСТРАЦИЯ',
            'night': `НОЧЬ #${round}`,
            'morning': 'УТРО',
            'day': `ДЕНЬ #${round}`,
            'vote': 'ГОЛОСОВАНИЕ',
            'defense': 'ЗАЩИТА',
            'judgement': 'СУД',
            'ended': 'ИГРА ОКОНЧЕНА'
        };

        indicator.textContent = phaseNames[phase] || phase.toUpperCase();
        indicator.className = `phase-indicator phase-${phase}`;
    }

    // ================= UTILS =================

    clearOverlays() {
        this.elements.nightOverlay.classList.remove('active');
        this.elements.dayOverlay.classList.remove('active');
        this.elements.deathOverlay.classList.remove('active');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ================= INITIALIZATION =================

    init() {
        // Chat input handler
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = this.elements.chatInput.value.trim();
                if (text) {
                    Game.sendMessage(text);
                    this.elements.chatInput.value = '';
                }
            }
        });

        // Close modal on overlay click
        this.elements.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.elements.modalOverlay) {
                // Only close if not a critical modal
                if (!this.currentModal?.classList.contains('critical')) {
                    this.closeModal();
                }
            }
        });
    }
}

// Global instance
const UI = new UIController();
document.addEventListener('DOMContentLoaded', () => UI.init());
