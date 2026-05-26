export class PresenceRenderer {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.escapeHTML = window.escapeHTML || ((str) => String(str).replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])));
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.eventBus.on("PRESENCE_UPDATED", (data) => {
            this.updateParticipantsListUI(data.participants, data.hostId, data.isHost);
        });

        this.eventBus.on("TYPING_UPDATED", (data) => {
            this.updateTypingIndicatorUI(data.activeTypers);
        });

        this.eventBus.on("JITSI_PARTICIPANTS_CHANGED", (data) => {
            this.latestJitsiData = data;
            const presence = this.kernel.get("network.presence");
            const socket = this.kernel.get("socket");
            const participants = presence ? presence.participants : new Map();
            const hostId = presence ? presence.hostId : null;
            const isHost = socket ? socket.isHost : false;
            this.updateParticipantsListUI(participants, hostId, isHost);
        });
    }

    onStop() {}

    updateParticipantsListUI(participants, hostId, isHost) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.presence", "updateParticipantsListUI", () => {
            const listContainer = document.getElementById("partyParticipantsList");
            const countContainer = document.getElementById("partyUserCount");
            if (!listContainer) return;

            const socket = this.kernel.get("socket");
            const presence = this.kernel.get("network.presence");
            const userName = presence ? presence.username || "You" : "You";

            if (countContainer) {
                countContainer.textContent = participants.size + 1; // Include self
            }

            const fragment = document.createDocumentFragment();
            
            // Jitsi local status
            const jitsi = this.kernel.get("jitsi");
            let localVoiceBadge = "";
            let localSpeakingClass = "";
            if (jitsi && jitsi.isJoined) {
                if (jitsi.dominantSpeaker === 'local') {
                    localVoiceBadge = ' <span class="speaking-indicator" title="Speaking">🔊</span>';
                    localSpeakingClass = " speaking";
                } else if (jitsi.micMuted) {
                    localVoiceBadge = ' <span class="muted-indicator" title="Muted">🔇</span>';
                } else {
                    localVoiceBadge = ' <span class="voice-active-indicator" title="Voice Connected">🎙️</span>';
                }
            }

            // Add local user
            const meRow = document.createElement("div");
            meRow.className = "party-member-row" + localSpeakingClass;
            const escapedLocalName = this.escapeHTML(userName);
            const firstCharLocal = this.escapeHTML(userName.charAt(0).toUpperCase());
            meRow.innerHTML = `
                <div class="party-member-avatar" style="background:#e50914;">${firstCharLocal}</div>
                <div class="party-member-info">
                    <span class="party-member-name">${escapedLocalName} (You) ${isHost ? '👑' : ''}${localVoiceBadge}</span>
                    <span class="party-member-role">${isHost ? 'Host' : 'Viewer'}</span>
                </div>
            `;
            fragment.appendChild(meRow);

            // Add other participants
            participants.forEach((p, sId) => {
                if (socket && sId === socket.getSocketId()) return;
                const pRow = document.createElement("div");
                
                // Find matching Jitsi participant
                let remoteVoiceBadge = "";
                let remoteSpeakingClass = "";
                if (jitsi && jitsi.isJoined) {
                    const jp = Array.from(jitsi.participants.values()).find(
                        jUser => jUser.name.toLowerCase() === p.displayName.toLowerCase()
                    );
                    if (jp) {
                        if (jp.speaking || jitsi.dominantSpeaker === jp.id) {
                            remoteVoiceBadge = ' <span class="speaking-indicator" title="Speaking">🔊</span>';
                            remoteSpeakingClass = " speaking";
                        } else if (jp.micMuted) {
                            remoteVoiceBadge = ' <span class="muted-indicator" title="Muted">🔇</span>';
                        } else {
                            remoteVoiceBadge = ' <span class="voice-active-indicator" title="Voice Connected">🎙️</span>';
                        }
                    }
                }

                pRow.className = "party-member-row" + remoteSpeakingClass;
                const isPHost = (sId === hostId);
                const escapedDisplayName = this.escapeHTML(p.displayName);
                const firstCharDisplay = this.escapeHTML(p.displayName.charAt(0).toUpperCase());
                pRow.innerHTML = `
                    <div class="party-member-avatar" style="background:#333;">${firstCharDisplay}</div>
                    <div class="party-member-info">
                        <span class="party-member-name">${escapedDisplayName} ${isPHost ? '👑' : ''}${remoteVoiceBadge}</span>
                        <span class="party-member-role">${isPHost ? 'Host' : 'Viewer'}</span>
                    </div>
                `;
                fragment.appendChild(pRow);
            });

            listContainer.innerHTML = "";
            listContainer.appendChild(fragment);
        });
    }

    updateTypingIndicatorUI(activeTypers) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.presence", "updateTypingIndicatorUI", () => {
            const indicator = document.getElementById("partyTypingIndicator");
            if (!indicator) return;

            const typers = activeTypers ? Array.from(activeTypers.values()) : [];
            if (typers.length === 0) {
                indicator.innerHTML = "";
            } else if (typers.length === 1) {
                indicator.innerHTML = `${this.escapeHTML(typers[0].name)} is typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
            } else if (typers.length === 2) {
                indicator.innerHTML = `${this.escapeHTML(typers[0].name)} and ${this.escapeHTML(typers[1].name)} are typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
            } else {
                indicator.innerHTML = `Multiple people are typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
            }
        });
    }
}
