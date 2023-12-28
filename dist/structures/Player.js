"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
const tslib_1 = require("tslib");
const Filters_1 = require("./Filters");
const Utils_1 = require("./Utils");
const _ = tslib_1.__importStar(require("lodash"));
const playerCheck_1 = tslib_1.__importDefault(require("../utils/playerCheck"));
class Player {
    options;
    /** The Queue for the Player. */
    queue = new (Utils_1.Structure.get("Queue"))();
    /** The filters applied to the audio. */
    filters;
    /** Whether the queue repeats the track. */
    trackRepeat = false;
    /** Whether the queue repeats the queue. */
    queueRepeat = false;
    /**Whether the queue repeats and shuffles after each song. */
    dynamicRepeat = false;
    /** The time the player is in the track. */
    position = 0;
    /** Whether the player is playing. */
    playing = false;
    /** Whether the player is paused. */
    paused = false;
    /** The volume for the player */
    volume;
    /** The Node for the Player. */
    node;
    /** The guild for the player. */
    guild;
    /** The voice channel for the player. */
    voiceChannel = null;
    /** The text channel for the player. */
    textChannel = null;
    /**The now playing message. */
    nowPlayingMessage;
    /** The current state of the player. */
    state = "DISCONNECTED";
    /** The equalizer bands array. */
    bands = new Array(15).fill(0.0);
    /** The voice state object from Discord. */
    voiceState;
    /** The Manager. */
    manager;
    static _manager;
    data = {};
    dynamicLoopInterval;
    /**
     * Set custom data.
     * @param key
     * @param value
     */
    set(key, value) {
        this.data[key] = value;
    }
    /**
     * Get custom data.
     * @param key
     */
    get(key) {
        return this.data[key];
    }
    /** @hidden */
    static init(manager) {
        this._manager = manager;
    }
    /**
     * Creates a new player, returns one if it already exists.
     * @param options
     */
    constructor(options) {
        this.options = options;
        if (!this.manager)
            this.manager = Utils_1.Structure.get("Player")._manager;
        if (!this.manager)
            throw new RangeError("Manager has not been initiated.");
        if (this.manager.players.has(options.guild)) {
            return this.manager.players.get(options.guild);
        }
        (0, playerCheck_1.default)(options);
        this.guild = options.guild;
        this.voiceState = Object.assign({
            op: "voiceUpdate",
            guild_id: options.guild,
        });
        if (options.voiceChannel)
            this.voiceChannel = options.voiceChannel;
        if (options.textChannel)
            this.textChannel = options.textChannel;
        const node = this.manager.nodes.get(options.node);
        this.node = node || this.manager.leastLoadNodes.first();
        if (!this.node)
            throw new RangeError("No available nodes.");
        this.manager.players.set(options.guild, this);
        this.manager.emit("playerCreate", this);
        this.setVolume(options.volume ?? 100);
        this.filters = new Filters_1.Filters(this);
    }
    /**
     * Same as Manager#search() but a shortcut on the player itself.
     * @param query
     * @param requester
     */
    search(query, requester) {
        return this.manager.search(query, requester);
    }
    /** Connect to the voice channel. */
    connect() {
        if (!this.voiceChannel)
            throw new RangeError("No voice channel has been set.");
        this.state = "CONNECTING";
        this.manager.options.send(this.guild, {
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: this.voiceChannel,
                self_mute: this.options.selfMute || false,
                self_deaf: this.options.selfDeafen || false,
            },
        });
        this.state = "CONNECTED";
        return this;
    }
    /** Disconnect from the voice channel. */
    disconnect() {
        if (this.voiceChannel === null)
            return this;
        this.state = "DISCONNECTING";
        this.pause(true);
        this.manager.options.send(this.guild, {
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: null,
                self_mute: false,
                self_deaf: false,
            },
        });
        this.voiceChannel = null;
        this.state = "DISCONNECTED";
        return this;
    }
    /** Destroys the player. */
    destroy(disconnect = true) {
        this.state = "DESTROYING";
        if (disconnect) {
            this.disconnect();
        }
        this.node.rest.destroyPlayer(this.guild);
        this.manager.emit("playerDestroy", this);
        this.manager.players.delete(this.guild);
    }
    /**
     * Sets the player voice channel.
     * @param channel
     */
    setVoiceChannel(channel) {
        if (typeof channel !== "string")
            throw new TypeError("Channel must be a non-empty string.");
        this.voiceChannel = channel;
        this.connect();
        return this;
    }
    /**
     * Sets the player text channel.
     * @param channel
     */
    setTextChannel(channel) {
        if (typeof channel !== "string")
            throw new TypeError("Channel must be a non-empty string.");
        this.textChannel = channel;
        return this;
    }
    /** Sets the now playing message. */
    setNowPlayingMessage(message) {
        if (!message) {
            throw new TypeError("You must provide the message of the now playing message.");
        }
        return (this.nowPlayingMessage = message);
    }
    async play(optionsOrTrack, playOptions) {
        if (typeof optionsOrTrack !== "undefined" &&
            Utils_1.TrackUtils.validate(optionsOrTrack)) {
            if (this.queue.current)
                this.queue.previous = this.queue.current;
            this.queue.current = optionsOrTrack;
        }
        if (!this.queue.current)
            throw new RangeError("No current track.");
        const finalOptions = playOptions
            ? playOptions
            : ["startTime", "endTime", "noReplace"].every((v) => Object.keys(optionsOrTrack || {}).includes(v))
                ? optionsOrTrack
                : {};
        if (Utils_1.TrackUtils.isUnresolvedTrack(this.queue.current)) {
            try {
                this.queue.current = await Utils_1.TrackUtils.getClosestTrack(this.queue.current);
            }
            catch (error) {
                this.manager.emit("trackError", this, this.queue.current, error);
                if (this.queue[0])
                    return this.play(this.queue[0]);
                return;
            }
        }
        await this.node.rest.updatePlayer({
            guildId: this.guild,
            data: {
                encodedTrack: this.queue.current?.track,
                ...finalOptions,
            },
        });
        Object.assign(this, { position: 0, playing: true });
    }
    /**
     * Sets the player volume.
     * @param volume
     */
    setVolume(volume) {
        if (isNaN(volume))
            throw new TypeError("Volume must be a number.");
        this.node.rest.updatePlayer({
            guildId: this.options.guild,
            data: {
                volume,
            },
        });
        this.volume = volume;
        return this;
    }
    /**
     * Sets the track repeat.
     * @param repeat
     */
    setTrackRepeat(repeat) {
        if (typeof repeat !== "boolean")
            throw new TypeError('Repeat can only be "true" or "false".');
        const oldPlayer = { ...this };
        if (repeat) {
            this.trackRepeat = true;
            this.queueRepeat = false;
            this.dynamicRepeat = false;
        }
        else {
            this.trackRepeat = false;
            this.queueRepeat = false;
            this.dynamicRepeat = false;
        }
        this.manager.emit("playerStateUpdate", oldPlayer, this);
        return this;
    }
    /**
     * Sets the queue repeat.
     * @param repeat
     */
    setQueueRepeat(repeat) {
        if (typeof repeat !== "boolean")
            throw new TypeError('Repeat can only be "true" or "false".');
        const oldPlayer = { ...this };
        if (repeat) {
            this.trackRepeat = false;
            this.queueRepeat = true;
            this.dynamicRepeat = false;
        }
        else {
            this.trackRepeat = false;
            this.queueRepeat = false;
            this.dynamicRepeat = false;
        }
        this.manager.emit("playerStateUpdate", oldPlayer, this);
        return this;
    }
    /**
     * Sets the queue to repeat and shuffles the queue after each song.
     * @param repeat "true" or "false".
     * @param ms After how many milliseconds to trigger dynamic repeat.
     */
    setDynamicRepeat(repeat, ms) {
        if (typeof repeat !== "boolean") {
            throw new TypeError('Repeat can only be "true" or "false".');
        }
        if (this.queue.size <= 1) {
            throw new RangeError("The queue size must be greater than 1.");
        }
        const oldPlayer = { ...this };
        if (repeat) {
            this.trackRepeat = false;
            this.queueRepeat = false;
            this.dynamicRepeat = true;
            this.dynamicLoopInterval = setInterval(() => {
                if (!this.dynamicRepeat)
                    return;
                const shuffled = _.shuffle(this.queue);
                this.queue.clear();
                shuffled.forEach((track) => {
                    this.queue.add(track);
                });
            }, ms);
        }
        else {
            clearInterval(this.dynamicLoopInterval);
            this.trackRepeat = false;
            this.queueRepeat = false;
            this.dynamicRepeat = false;
        }
        this.manager.emit("playerStateUpdate", oldPlayer, this);
        return this;
    }
    /** Restarts the current track to the start. */
    restart() {
        if (!this.queue.current?.track) {
            if (this.queue.length)
                this.play();
            return;
        }
        this.node.rest.updatePlayer({
            guildId: this.guild,
            data: {
                position: 0,
                encodedTrack: this.queue.current?.track,
            },
        });
    }
    /** Stops the current track, optionally give an amount to skip to, e.g 5 would play the 5th song. */
    stop(amount) {
        if (typeof amount === "number" && amount > 1) {
            if (amount > this.queue.length)
                throw new RangeError("Cannot skip more than the queue length.");
            this.queue.splice(0, amount - 1);
        }
        this.node.rest.updatePlayer({
            guildId: this.guild,
            data: {
                encodedTrack: null,
            },
        });
        return this;
    }
    /**
     * Pauses the current track.
     * @param pause
     */
    pause(pause) {
        if (typeof pause !== "boolean")
            throw new RangeError('Pause can only be "true" or "false".');
        if (this.paused === pause || !this.queue.totalSize)
            return this;
        const oldPlayer = { ...this };
        this.playing = !pause;
        this.paused = pause;
        this.node.rest.updatePlayer({
            guildId: this.guild,
            data: {
                paused: pause,
            },
        });
        this.manager.emit("playerStateUpdate", oldPlayer, this);
        return this;
    }
    /** Go back to the previous song. */
    previous() {
        this.queue.unshift(this.queue.previous);
        this.stop();
        return this;
    }
    /**
     * Seeks to the position in the current track.
     * @param position
     */
    seek(position) {
        if (!this.queue.current)
            return undefined;
        position = Number(position);
        if (isNaN(position)) {
            throw new RangeError("Position must be a number.");
        }
        if (position < 0 || position > this.queue.current.duration)
            position = Math.max(Math.min(position, this.queue.current.duration), 0);
        this.position = position;
        this.node.rest.updatePlayer({
            guildId: this.guild,
            data: {
                position: position,
            },
        });
        return this;
    }
}
exports.Player = Player;
