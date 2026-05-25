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
     * Dynamically downloads Jitsi Meet External API SDK
     * @returns {Promise<void>} Resolves when script is fully loaded and ready
     */
    _loadSDK() {
        return new Promise((resolve, reject) => {
            if (window.JitsiMeetExternalAPI) return resolve();
            
            const script = document.createElement("script");
            script.src = `https://${PARTY_CONFIG.DOMAIN}/${PARTY_CONFIG.APP_ID}/external_api.js`;
            script.async = true;
            script.onload = () => {
                if (window.JitsiMeetExternalAPI) {
                    resolve();
                } else {
                    reject(new Error("Jitsi Meet SDK not defined after load."));
                }
            };
            script.onerror = () => reject(new Error("Failed to download Jitsi Meet external script."));
            document.head.appendChild(script);
        });
    }

    /**
     * Starts Jitsi connection, hooking iframe creation to configure display-capture.
     * @param {HTMLElement} parentNode UI element to append iframe to
     * @returns {Promise<object>} Resolves with JitsiMeetExternalAPI instance
     */
    async initSession(parentNode) {
        if (!this.roomId || !this.username) {
            throw new Error("Identity parameters setupLocalIdentity() must be initialized first.");
        }

        await this._loadSDK();

        const roomName = `${PARTY_CONFIG.APP_ID}/${this.roomId}`;
        
        const options = {
            roomName: roomName,
            parentNode: parentNode,
            width: "100%",
            height: "100%",
            configOverwrite: {
                startWithAudioMuted: !this.isHost,
                startWithVideoMuted: true,
                prejoinPageEnabled: false,
                enableWelcomePage: false,
                toolbarButtons: [
                    'microphone', 'camera', 'desktop', 'hangup',
                    'chat', 'raisehand', 'tileview'
                ],
                filmStripOnly: false,
                desktopSharingEnabled: true
            },
            interfaceConfigOverwrite: {
                SHOW_JITSI_WATERMARK: false,
                HIDE_DEEP_LINKING_LOGO: true
            },
            userInfo: {
                displayName: this.username
            }
        };

        // Temporary hook on document.createElement for secure iframe permissions
        const originalCreateElement = document.createElement;
        const REQUIRED_ALLOW = 'camera; microphone; display-capture; fullscreen; autoplay; clipboard-write; screen-wake-lock';
        
        document.createElement = function (tagName, opts) {
            const element = originalCreateElement.call(document, tagName, opts);
            if (tagName && tagName.toLowerCase() === 'iframe') {
                element.setAttribute('allow', REQUIRED_ALLOW);
                
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function (name, value) {
                    if (name === 'allow') {
                        let val = value || '';
                        ['display-capture', 'camera', 'microphone', 'fullscreen', 'autoplay', 'clipboard-write', 'screen-wake-lock']
                        .forEach(perm => {
                            if (val.indexOf(perm) === -1) val = val ? `${val}; ${perm}` : perm;
                        });
                        return originalSetAttribute.call(element, name, val);
                    }
                    return originalSetAttribute.call(element, name, value);
                };
            }
            return element;
        };

        try {
            this.api = new JitsiMeetExternalAPI(PARTY_CONFIG.DOMAIN, options);
        } finally {
            document.createElement = originalCreateElement;
        }

        this._registerEvents();
        return this.api;
    }

    _registerEvents() {
        if (!this.api) return;

        this.api.addListener("videoConferenceJoined", (event) => {
            this.reconnectAttempts = 0;
            this.bus.emit("joined", event);
        });

        this.api.addListener("participantJoined", (p) => {
            this.participants.set(p.id, { id: p.id, displayName: p.displayName || "Participant", isSpeaking: false });
            this.bus.emit("participantJoined", p);
        });

        this.api.addListener("participantLeft", (p) => {
            this.participants.delete(p.id);
            this.bus.emit("participantLeft", p);
        });

        this.api.addListener("dominantSpeakerChanged", (speaker) => {
            this.participants.forEach((data, id) => {
                data.isSpeaking = (id === speaker.id);
            });
            this.bus.emit("dominantSpeakerChanged", speaker);
        });

        this.api.addListener("endpointTextMessageReceived", (event) => {
            if (event?.eventData?.text) {
                const parsed = ProtocolHelpers.safeParse(event.eventData.text);
                if (ProtocolHelpers.isValidEnvelope(parsed)) {
                    this.witnessClock(parsed.lamport);
                    this.bus.emit("syncCommand", parsed);
                }
            }
        });

        this.api.addListener("videoConferenceLeft", () => {
            this.bus.emit("left");
        });
    }

    /**
     * Packages and broadcasts a command to all Jitsi participants.
     * @param {string} namespace Command namespace
     * @param {string} event Event type
     * @param {object} payload Command parameters
     */
    broadcastCommand(namespace, event, payload) {
        if (!this.api) return;
        const envelope = this.packageCommand(namespace, event, payload);
        this.api.executeCommand("sendEndpointTextMessage", "", JSON.stringify(envelope));
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
