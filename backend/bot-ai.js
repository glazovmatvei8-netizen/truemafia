/**
 * Bot AI
 * Ported from Python Bot class with all logic preserved
 */

class BotAI {
    constructor(player) {
        this.player = player;
        this.uid = player.id;
        this.name = player.name;
        this.personality = this._randomPersonality();

        this.memory = {
            players: {},
            lastSpeaker: null,
            suspicious: new Set(),
            trusted: new Set(),
            mafiaKnown: new Set(),
            dayMessages: [],
            myRole: null,
            myTeam: null
        };

        this.mood = 'нейтральный';
    }

    _randomPersonality() {
        const personalities = ['агрессивный', 'тихий', 'дружелюбный', 'подозрительный', 'хитрый'];
        return personalities[Math.floor(Math.random() * personalities.length)];
    }

    initGame(role, team, game) {
        this.memory.myRole = role;
        this.memory.myTeam = team;

        for (const [uid, p] of game.players) {
            if (uid !== this.uid) {
                this.memory.players[uid] = {
                    messages: 0,
                    votesAgainst: 0,
                    votesFor: 0,
                    defended: [],
                    attacked: [],
                    silentRounds: 0,
                    suspicionScore: 0
                };
            }
        }

        // If mafia, remember allies
        if (team === 'mafia') {
            for (const [uid, p] of game.players) {
                if (p.team === 'mafia' && uid !== this.uid) {
                    this.memory.mafiaKnown.add(uid);
                    this.memory.trusted.add(uid);
                }
            }
        }
    }

    onDayStart() {
        this.memory.dayMessages = [];
        for (const uid in this.memory.players) {
            this.memory.players[uid].messagesToday = 0;
        }
    }

    onMessage(speakerUid, text, game) {
        if (speakerUid === this.uid) return null;

        const p = this.memory.players[speakerUid];
        if (p) {
            p.messages++;
            this.memory.lastSpeaker = speakerUid;
        }

        const textLower = text.toLowerCase();

        // Suspicious: claiming civilian
        if (textLower.includes('мирн') && textLower.includes('я')) {
            if (p) p.suspicionScore += 10;
        }

        // Defending others
        if (['защищаю', 'доверяю', 'не трогайте', 'мирный'].some(w => textLower.includes(w))) {
            for (const [uid, player] of game.players) {
                if (uid !== speakerUid && player.alive) {
                    const name = player.name.toLowerCase();
                    if (textLower.includes(name)) {
                        if (p) {
                            p.defended.push(uid);
                            if (this.memory.mafiaKnown.has(uid)) {
                                p.suspicionScore += 25;
                            }
                        }
                    }
                }
            }
        }

        // Attacking others
        if (['мафия', 'убейте', 'казните', 'вешайте', 'подозрительн'].some(w => textLower.includes(w))) {
            for (const [uid, player] of game.players) {
                if (uid !== speakerUid && player.alive) {
                    const name = player.name.toLowerCase();
                    if (textLower.includes(name)) {
                        if (p) p.attacked.push(uid);
                    }
                }
            }
        }

        // Decide to respond
        let chance = 0.05;
        const myFirstName = this.name.split(' ')[0].toLowerCase();

        if (textLower.includes(myFirstName)) chance = 0.7;
        if (textLower.includes(this.name.toLowerCase()) && ['мафия', 'подозрительн', 'врёшь'].some(w => textLower.includes(w))) {
            chance = 0.9;
            this.mood = 'агрессивный';
        }

        if (Math.random() < chance) {
            return this._generateResponse(speakerUid, text, game);
        }

        return null;
    }

    _generateResponse(toUid, text, game) {
        const textLower = text.toLowerCase();
        const toName = game.players.get(toUid)?.name || 'Игрок';

        // Defending against accusation
        if (textLower.includes(this.name.toLowerCase()) && ['мафия', 'подозрительн'].some(w => textLower.includes(w))) {
            const defenses = [
                `Зачем ты на меня наезжаешь, ${toName}? Я мирный!`,
                `Это провокация! ${toName} сам подозрителен!`,
                `Не верьте ${toName}, он путает город!`,
                `Я готов поклясться — я не мафия!`,
                `Почему именно я? ${toName} что-то скрывает...`
            ];
            return defenses[Math.floor(Math.random() * defenses.length)];
        }

        // Reacting to civilian claim
        if (textLower.includes('мирн')) {
            const p = this.memory.players[toUid];
            if (p && p.suspicionScore > 30) {
                const responses = [
                    `Слишком уж ты уверяешь, ${toName}...`,
                    `Каждый второй так говорит, а потом оказывается мафия.`,
                    `Покажи это делами, ${toName}, а не словами.`
                ];
                return responses[Math.floor(Math.random() * responses.length)];
            } else {
                const responses = [
                    `Пока верю тебе, ${toName}.`,
                    `Да, ${toName} ведёт себя нормально.`,
                    `Может быть, может быть...`
                ];
                return responses[Math.floor(Math.random() * responses.length)];
            }
        }

        // Reacting to vote proposal
        if (['голосуем', 'казнить', 'вешать'].some(w => textLower.includes(w))) {
            for (const [uid, player] of game.players) {
                if (uid !== toUid && player.alive) {
                    const name = player.name.toLowerCase();
                    if (textLower.includes(name)) {
                        if (this.memory.myTeam === 'mafia' && player.team !== 'mafia') {
                            return `Согласен с ${toName}! ${player.name} ведёт себя странно.`;
                        }
                        if (this.memory.myTeam === 'mafia' && this.memory.mafiaKnown.has(uid)) {
                            return `Не торопитесь! ${player.name} может быть мирным. Посмотрите на ${toName}!`;
                        }
                        const p = this.memory.players[uid];
                        if (p && p.suspicionScore > 40) {
                            return `Да, ${player.name} давно на мушке. Поддерживаю.`;
                        } else {
                            return `Не знаю... ${player.name} не так уж подозрителен.`;
                        }
                    }
                }
            }
        }

        // Default responses
        const responses = [
            `${toName}, ты уверен в своих словах?`,
            `Интересно... Нужно подумать.`,
            `Я присмотрю за ${toName}, спасибо за информацию.`,
            `Кто-то другой что думает?`,
            `Пока рано делать выводы.`,
            `${toName}, а ты сам не мафия случайно?)`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    chooseTarget(game, action) {
        const alive = Array.from(game.players.values())
            .filter(p => p.alive && p.id !== this.uid);

        if (alive.length === 0) return null;

        const myRole = this.memory.myRole;
        const myTeam = this.memory.myTeam;

        // MAFIA / DON: kill
        if (action === 'm_kill') {
            const targets = alive.filter(p => p.team !== 'mafia');
            if (targets.length === 0) return null;

            // Prioritize dangerous players (active speakers)
            const dangerous = targets.filter(t => {
                const p = this.memory.players[t.id];
                return p && p.messages > 3;
            });

            if (dangerous.length > 0 && Math.random() < 0.5) {
                return dangerous[Math.floor(Math.random() * dangerous.length)].id;
            }

            // Prioritize known roles
            for (const t of targets) {
                if (['Комиссар', 'Доктор'].includes(t.role) && Math.random() < 0.4) {
                    return t.id;
                }
            }

            return targets[Math.floor(Math.random() * targets.length)].id;
        }

        // DOCTOR: heal
        if (action === 'd_heal') {
            if (Math.random() < 0.5) return this.uid;

            const goodTargets = alive.filter(p => !p.isBot);
            if (goodTargets.length > 0 && Math.random() < 0.6) {
                return goodTargets[Math.floor(Math.random() * goodTargets.length)].id;
            }

            return alive[Math.floor(Math.random() * alive.length)].id;
        }

        // COMMISSAR: check
        if (action === 'c_check') {
            const suspects = alive.filter(t => {
                const p = this.memory.players[t.id];
                return p && p.suspicionScore > 20;
            });

            if (suspects.length > 0 && Math.random() < 0.7) {
                return suspects[Math.floor(Math.random() * suspects.length)].id;
            }

            const quiet = alive.filter(t => {
                const p = this.memory.players[t.id];
                return !p || p.messages < 2;
            });

            if (quiet.length > 0 && Math.random() < 0.3) {
                return quiet[Math.floor(Math.random() * quiet.length)].id;
            }

            return alive[Math.floor(Math.random() * alive.length)].id;
        }

        // PUTANA: block
        if (action === 'p_block') {
            const targets = alive.filter(t => {
                const p = this.memory.players[t.id];
                return p && (p.suspicionScore > 15 || p.messages > 4);
            });

            if (targets.length > 0 && Math.random() < 0.6) {
                return targets[Math.floor(Math.random() * targets.length)].id;
            }

            return alive[Math.floor(Math.random() * alive.length)].id;
        }

        // MANIAC: kill
        if (action === 'maniac_kill') {
            return alive[Math.floor(Math.random() * alive.length)].id;
        }

        // BODYGUARD: protect
        if (action === 't_protect') {
            if (Math.random() < 0.3) return this.uid;

            const loud = alive.filter(t => {
                const p = this.memory.players[t.id];
                return p && p.messages > 2;
            });

            if (loud.length > 0 && Math.random() < 0.5) {
                return loud[Math.floor(Math.random() * loud.length)].id;
            }

            return alive[Math.floor(Math.random() * alive.length)].id;
        }

        return alive[Math.floor(Math.random() * alive.length)]?.id || null;
    }

    chooseVote(game) {
        const alive = Array.from(game.players.values())
            .filter(p => p.alive && p.id !== this.uid);

        if (alive.length === 0) return null;

        const myTeam = this.memory.myTeam;

        // MAFIA: vote against civilians
        if (myTeam === 'mafia') {
            const nonMafia = alive.filter(p => p.team !== 'mafia');
            if (nonMafia.length === 0) return null;

            // Bandwagon: support leading vote
            const votes = {};
            for (const p of game.players.values()) {
                if (p.votedFor) {
                    votes[p.votedFor] = (votes[p.votedFor] || 0) + 1;
                }
            }

            if (Object.keys(votes).length > 0) {
                const leader = Object.entries(votes)
                    .sort((a, b) => b[1] - a[1])[0][0];
                const leaderVotes = votes[leader];

                if (nonMafia.some(p => p.id === leader) && leaderVotes >= 2 && Math.random() < 0.8) {
                    return leader;
                }
            }

            // Vote against active civilian
            const active = nonMafia.filter(t => {
                const p = this.memory.players[t.id];
                return p && p.messages > 2;
            });

            if (active.length > 0 && Math.random() < 0.6) {
                return active[Math.floor(Math.random() * active.length)].id;
            }

            return nonMafia[Math.floor(Math.random() * nonMafia.length)].id;
        }

        // CIVILIANS: smart voting
        const scores = {};
        for (const p of alive) {
            const mem = this.memory.players[p.id] || {};
            let score = mem.suspicionScore || 0;

            // Quiet players are suspicious
            if ((mem.messages || 0) < 2) score += 15;

            // Defending mafia is suspicious
            for (const defended of mem.defended || []) {
                const dp = game.players.get(defended);
                if (dp?.team === 'mafia' || this.memory.mafiaKnown.has(defended)) {
                    score += 20;
                }
            }

            // Bandwagon bonus
            let votesAgainst = 0;
            for (const op of game.players.values()) {
                if (op.votedFor === p.id) votesAgainst++;
            }
            if (votesAgainst >= 2) score += 10;

            scores[p.id] = score;
        }

        const best = Object.entries(scores)
            .sort((a, b) => b[1] - a[1])[0];

        if (best && best[1] > 0 && Math.random() < 0.7) {
            return best[0];
        }

        return alive[Math.floor(Math.random() * alive.length)].id;
    }

    chooseJudgement(game) {
        if (this.personality === 'агрессивный') {
            return Math.random() < 0.7 ? 'guilty' : 'innocent';
        } else if (this.personality === 'дружелюбный') {
            return Math.random() < 0.7 ? 'innocent' : 'guilty';
        }
        return Math.random() < 0.5 ? 'guilty' : 'innocent';
    }

    speak(game) {
        const alive = Array.from(game.players.values())
            .filter(p => p.alive && p.id !== this.uid);

        const topics = [];

        // Topic 1: Accuse most suspicious
        if (alive.length > 0) {
            const scores = {};
            for (const p of alive) {
                const mem = this.memory.players[p.id] || {};
                scores[p.id] = (mem.suspicionScore || 0) + ((mem.messages || 0) < 2 ? 20 : 0);
            }

            const mostSuspicious = Object.entries(scores)
                .sort((a, b) => b[1] - a[1])[0];

            if (mostSuspicious && mostSuspicious[1] > 15) {
                const pid = mostSuspicious[0];
                const p = game.players.get(pid);
                topics.push(`Я думаю, ${p?.name} ведёт себя подозрительно. Мало говорит или защищает мафию.`);
                topics.push(`Голосуем за ${p?.name}! Он(а) точно не мирный.`);
                topics.push(`${p?.name}, объяснись! Почему ты так тихо себя ведёшь?`);
            }
        }

        // Topic 2: Defend trusted
        const trusted = alive.filter(p => this.memory.trusted.has(p.id));
        if (trusted.length > 0) {
            const t = trusted[Math.floor(Math.random() * trusted.length)];
            topics.push(`Я доверяю ${t.name}. Ведёт себя как мирный.`);
            topics.push(`Не трогайте ${t.name}! Он(а) точно не мафия.`);
        }

        // Topic 3: Analyze votes
        const votes = {};
        for (const p of game.players.values()) {
            if (p.votedFor) votes[p.votedFor] = (votes[p.votedFor] || 0) + 1;
        }

        if (Object.keys(votes).length > 0) {
            const leader = Object.entries(votes)
                .sort((a, b) => b[1] - a[1])[0][0];
            const voteCount = votes[leader];

            if (voteCount >= 2 && alive.some(p => p.id === leader)) {
                const lp = game.players.get(leader);
                if (this.memory.trusted.has(leader)) {
                    topics.push(`Зачем все на ${lp?.name}? Он(а) мирный! Пересмотрите!`);
                } else {
                    topics.push(`Много голосов против ${lp?.name}. Может он(а) и правда мафия?`);
                    topics.push(`Я присоединяюсь — ${lp?.name} подозрителен.`);
                }
            }
        }

        // General phrases
        topics.push(
            'Кто ещё что думает? Нужно больше информации.',
            'Я мирный, ищу мафию. Давайте вместе.',
            'Что-то здесь не чисто...',
            'Надо быть осторожнее с голосованием.',
            `Кто из ${alive.length} живых мафия? Давайте думать.`,
            'Прошлая ночь была спокойной — значит мафия хитрая.'
        );

        // Mafia confusion
        if (this.memory.myTeam === 'mafia' && Math.random() < 0.4) {
            const confuse = [
                'Мне кажется, мафия среди тихих.',
                'Не верьте активным — они могут отвлекать!',
                `Почему никто не смотрит на ${alive[Math.floor(Math.random() * alive.length)]?.name}?`,
                'Я запутался... Кто-то манипулирует нами.'
            ];
            return confuse[Math.floor(Math.random() * confuse.length)];
        }

        return topics[Math.floor(Math.random() * topics.length)];
    }

    onVoteSeen(voter, target) {
        if (this.memory.players[voter]) {
            this.memory.players[voter].votesFor++;
        }

        if (target && this.memory.players[target]) {
            this.memory.players[target].votesAgainst++;
        }

        // If mafia and someone votes against mafia
        if (this.memory.myTeam === 'mafia' && this.memory.mafiaKnown.has(target)) {
            if (this.memory.players[voter]) {
                this.memory.players[voter].suspicionScore += 15;
            }
        }
    }
}

module.exports = { BotAI };
