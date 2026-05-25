/**
 * @file ProtocolHelpers.js
 * @description Helper functions for protocol message validation, serializations, and cryptography.
 */
import { PARTY_CONFIG } from './config.js';

export class ProtocolHelpers {
    /**
     * Generates a cryptographically secure random Room ID.
     * @returns {string} Hexadecimal room identifier (32 chars)
     */
    static generateSecureRoomId() {
        const array = new Uint8Array(16);
        window.crypto.getRandomValues(array);
        return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
    }

    /**
     * Safely parses JSON messages, returning null on failure instead of throwing.
     * @param {string} rawString JSON payload string
     * @returns {object|null} Parsed object or null
     */
    static safeParse(rawString) {
        if (typeof rawString !== 'string') return null;
        try {
            return JSON.parse(rawString);
        } catch (error) {
            return null;
        }
    }

    /**
     * Wraps a payload in the standardized protocol envelope.
     * @param {string} namespace Message namespace (e.g. "playback")
     * @param {string} event Event type name
     * @param {object} sender Sender identity details
     * @param {object} payload Inner message parameters
     * @param {number} seq Monotonically increasing sequence number
     * @param {number} lamport Current Lamport timestamp
     * @returns {object} Standardized message object
     */
    static createEnvelope(namespace, event, sender, payload, seq, lamport) {
        return {
            v: PARTY_CONFIG.VERSION,
            ns: namespace,
            event: event,
            sender: {
                sessionId: sender.sessionId,
                userId: sender.userId,
                isHost: sender.isHost
            },
            payload: payload,
            ts: Date.now(),
            seq: seq,
            lamport: lamport
        };
    }

    /**
     * Validates that an object satisfies the base event envelope constraints.
     * @param {object} msg Parsed envelope object
     * @returns {boolean} True if envelope is valid
     */
    static isValidEnvelope(msg) {
        if (!msg || typeof msg !== 'object') return false;
        return (
            typeof msg.v === 'string' &&
            typeof msg.ns === 'string' &&
            typeof msg.event === 'string' &&
            msg.sender && typeof msg.sender === 'object' &&
            typeof msg.sender.sessionId === 'string' &&
            typeof msg.sender.userId === 'string' &&
            typeof msg.sender.isHost === 'boolean' &&
            msg.payload && typeof msg.payload === 'object' &&
            typeof msg.ts === 'number' &&
            typeof msg.seq === 'number' &&
            typeof msg.lamport === 'number'
        );
    }
}
