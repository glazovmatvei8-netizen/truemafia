/**
 * TrueMafia Lobby Logic
 * Room listing, creation, joining
 */

const Lobby = {
    rooms: [],
    currentFilter: 'all',

    init() {
        this.bindEvents();
        this.loadRooms();
        this.startPolling();
        this.updateOnlineCount();
    },

    bindEvents() {
        // Create room button
        document.getElementById('create-room-btn')?.addEventListener('click', () => {
            UI.showModal('create-modal');
        });

        // Modal close
        document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el) {
                    el.closest('.modal')?.classList.remove('active');
                }
            });
        });

        // Create room form
        document.getElementById('create-room-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createRoom();
        });

        // Filter tabs
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentFilter = tab.dataset.filter;
                this.renderRooms();
            });
        });

        // Quick buttons
        document.getElementById('quick-join-btn')?.addEventListener('click', () => {
            this.quickJoin();
        });

        document.getElementById('play-bots-btn')?.addEventListener('click', () => {
            this.playWithBots();
        });

        // Shop link
        document.getElementById('shop-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'profile.html#shop';
        });

        // Socket events
        socket.on('rooms_list', (data) => {
            this.rooms = data.rooms || [];
            this.renderRooms();
        });

        socket.on('room_created', (data) => {
            UI.toast('Комната создана!', 'success');
            this.joinRoom(data.roomId);
        });

        socket.on('joined_room', (data) => {
            window.location.href = `game.html?room=${data.roomId}`;
        });

        socket.on('error', (data) => {
            UI.toast(data.message, 'error');
        });
    },

    loadRooms() {
        socket.emit('get_rooms', {});
    },

    startPolling() {
        setInterval(() => {
            this.loadRooms();
            this.updateOnlineCount();
        }, 5000);
    },

    updateOnlineCount() {
        // Simulated - in production fetch from server
        const online = Math.floor(Math.random() * 50) + 20;
        const games = this.rooms.filter(r => r.status === 'playing').length;

        document.getElementById('online-count')?.textContent = online;
        document.getElementById('games-count')?.textContent = games;
    },

    renderRooms() {
        const grid = document.getElementById('rooms-grid');
        if (!grid) return;

        const filtered = this.rooms.filter(room => {
            if (this.currentFilter === 'all') return true;
            return room.status === this.currentFilter;
        });

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                    <p style="font-size: 48px; margin-bottom: 16px;">📭</p>
                    <p>Нет активных комнат</p>
                    <p style="font-size: 13px; margin-top: 8px;">Создайте свою или играйте с ботами!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(room => this.renderRoomCard(room)).join('');

        // Add click handlers
        grid.querySelectorAll('.room-card').forEach(card => {
            card.addEventListener('click', () => {
                const roomId = card.dataset.roomId;
                this.joinRoom(roomId);
            });
        });
    },

    renderRoomCard(room) {
        const statusClass = room.status;
        const statusText = room.status === 'waiting' ? 'Ожидание' : 'В игре';
        const playerCount = room.players?.length || 0;
        const maxPlayers = room.maxPlayers || 12;
        const botCount = room.bots || 0;

        return `
            <div class="room-card" data-room-id="${room.id}">
                <div class="room-header">
                    <span class="room-name">${room.name || 'Без названия'}</span>
                    <span class="room-status ${statusClass}">${statusText}</span>
                </div>
                <div class="room-info">
                    <span class="room-players">👥 ${playerCount}/${maxPlayers}</span>
                    <span>🤖 ${botCount} ботов</span>
                    <span>🎭 ${room.mode || 'classic'}</span>
                </div>
                <div class="room-avatars">
                    ${(room.playerAvatars || []).slice(0, 5).map(() => 
                        `<img src="https://via.placeholder.com/24" alt="player">`
                    ).join('')}
                    ${playerCount > 5 ? `<span style="font-size: 11px; color: var(--text-muted);">+${playerCount - 5}</span>` : ''}
                </div>
            </div>
        `;
    },

    createRoom() {
        const settings = {
            name: document.getElementById('room-name')?.value || 'Моя мафия',
            minPlayers: parseInt(document.getElementById('min-players')?.value) || 4,
            maxPlayers: parseInt(document.getElementById('max-players')?.value) || 12,
            regTime: parseInt(document.getElementById('reg-time')?.value) || 60,
            nightTime: parseInt(document.getElementById('night-time')?.value) || 60,
            dayTime: parseInt(document.getElementById('day-time')?.value) || 120,
            voteTime: parseInt(document.getElementById('vote-time')?.value) || 30,
            showRoles: document.getElementById('show-roles')?.checked ?? true,
            mode: document.getElementById('game-mode')?.value || 'classic'
        };

        socket.createRoom(settings);
        UI.hideModal('create-modal');
    },

    joinRoom(roomId) {
        socket.joinRoom(roomId);
    },

    quickJoin() {
        const waitingRooms = this.rooms.filter(r => r.status === 'waiting');
        if (waitingRooms.length > 0) {
            const room = waitingRooms[Math.floor(Math.random() * waitingRooms.length)];
            this.joinRoom(room.id);
        } else {
            UI.toast('Нет доступных комнат. Создайте свою!', 'warning');
        }
    },

    playWithBots() {
        // Create room with bots and auto-start
        const settings = {
            name: 'Игра с ботами',
            minPlayers: 4,
            maxPlayers: 12,
            regTime: 10,
            nightTime: 30,
            dayTime: 60,
            voteTime: 20,
            showRoles: true,
            mode: 'classic',
            withBots: true,
            botCount: 8
        };
        socket.createRoom(settings);
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('rooms-grid')) {
        Lobby.init();
    }
});
