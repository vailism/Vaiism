/**
 * @file PresenceManager.js
 * @description Renders active participants, speaking highlight status, and avatar badges.
 */
export class PresenceManager {
    /**
     * @param {HTMLElement} listContainer DOM node to inject member rows into
     * @param {RoomManager} roomManager Room coordinator instance
     */
    constructor(listContainer, roomManager) {
        this.container = listContainer;
        this.room = roomManager;
        this.unsubscribes = [];

        this._setupListeners();
    }

    _setupListeners() {
        const bus = this.room.bus;
        
        // Push unbind closures to avoid memory leaks during dynamic component teardowns
        this.unsubscribes.push(bus.on("joined", () => this.renderList()));
        this.unsubscribes.push(bus.on("participantJoined", () => this.renderList()));
        this.unsubscribes.push(bus.on("participantLeft", () => this.renderList()));
        this.unsubscribes.push(bus.on("dominantSpeakerChanged", () => this.renderList()));
    }

    /**
     * Renders local and remote users in the participants tray
     */
    renderList() {
        if (!this.container) return;
        this.container.innerHTML = "";

        // 1. Render Local User Row
        const localUser = localStorage.getItem('vailism_current_user') || 'You';
        this.container.appendChild(this._createMemberRow(localUser, true, this.room.isHost, false));

        // 2. Render Remote User Rows
        this.room.participants.forEach(p => {
            this.container.appendChild(this._createMemberRow(p.displayName, false, false, p.isSpeaking));
        });
    }

    _createMemberRow(name, isSelf, isHost, isSpeaking) {
        const row = document.createElement("div");
        row.className = "party-member-row";
        if (isSpeaking) {
            row.classList.add("speaking");
        }

        const badgeColor = isSelf ? "#e50914" : "#333";
        const crown = isHost ? '<span class="crown-icon" style="color:#ffcc00;margin-right:4px;">👑</span>' : '';
        const speakingIndicator = isSpeaking ? '<span class="speaking-indicator">🗣️</span>' : '';

        row.innerHTML = `
            <div class="party-member-avatar" style="background:${badgeColor}; font-weight: 600;">
                ${name.charAt(0).toUpperCase()}
            </div>
            <div class="party-member-details" style="display:flex; align-items:center; flex-grow:1; justify-content:space-between;">
                <span class="party-member-name">${crown}${name} ${isSelf ? '<span style="opacity:0.6;font-size:11px;">(You)</span>' : ''}</span>
                ${speakingIndicator}
            </div>
        `;
        return row;
    }

    /**
     * Unbinds event listeners and references.
     */
    destroy() {
        this.unsubscribes.forEach(fn => fn());
        this.unsubscribes = [];
        this.container = null;
        this.room = null;
    }
}
