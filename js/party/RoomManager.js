/**
 * @file RoomManager.js
 * @description Core coordinator for Jitsi session tracking, message routing, and local connectivity.
 */
import { PARTY_CONFIG } from './config.js';
import { EventBus } from './EventBus.js';
import { GarbageCollector } from './GarbageCollector.js';
import { ProtocolHelpers } from './ProtocolHelpers.js';

export class RoomManager {
    constructor() {
        this.bus = new EventBus();
        this.gc = new GarbageCollector();
        this.participants = new Map();
        
        this.localSessionId = Math.random().toString(36).substr(2, 9);
        this.isHost = false;
        this.roomId = null;
        this.username = null;
        
        this.reconnectAttempts = 0;
        this.api = null;
        this.lamportTime = 0;
        this.seqCounter = 0;
    }

    /**
     * Increments and returns the current Lamport logical clock tick.
     * @returns {number} New Lamport tick
     */
    tickClock() {
        this.lamportTime += 1;
        return this.lamportTime;
    }

    /**
     * Witnesses a remote Lamport timestamp and aligns the clock.
     * @param {number} remoteTime Inbound Lamport timestamp
     */
    witnessClock(remoteTime) {
        this.lamportTime = Math.max(this.lamportTime, remoteTime) + 1;
    }

    /**
     * Pre-initializes local state parameters.
     * @param {string} roomId Room token
     * @param {string} username Display name of local participant
     * @param {boolean} isHost True if local participant is creator
     */
    setupLocalIdentity(roomId, username, isHost = false) {
        this.roomId = roomId;
        this.username = username;
        this.isHost = isHost;
        this.reconnectAttempts = 0;
        this.participants.clear();
        
        console.log(`[RoomManager] Identity established: ${username} (${this.localSessionId}), Host: ${isHost}`);
    }

    /**
     * Increments sequence counter and creates an outbound enveloped command.
     * @param {string} namespace Command namespace
     * @param {string} event Event type
     * @param {object} payload Command parameters
     * @returns {object} Standardized envelope ready to broadcast
     */
    packageCommand(namespace, event, payload) {
        this.seqCounter++;
        const clock = this.tickClock();
        const sender = {
            sessionId: this.localSessionId,
            userId: this.username,
            isHost: this.isHost
        };
        return ProtocolHelpers.createEnvelope(namespace, event, sender, payload, this.seqCounter, clock);
    }

    /**
     * Unbinds Jitsi event registrations and clears local memory maps.
     */
    destroy() {
        console.log("[RoomManager] Tearing down session and freeing resources...");
        if (this.api) {
            try {
                this.api.executeCommand("hangup");
                this.api.dispose();
            } catch (e) {
                console.warn("[RoomManager] Error disposing Jitsi Meet External API:", e);
            }
            this.api = null;
        }

        this.gc.cleanup();
        this.bus.clear();
        this.participants.clear();
        this.roomId = null;
        this.username = null;
        this.isHost = false;
        this.reconnectAttempts = 0;
        this.lamportTime = 0;
        this.seqCounter = 0;
    }
}
