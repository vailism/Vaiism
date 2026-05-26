export class JitsiManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.api = null;
        this.isJoined = false;
        this.roomCode = null;
        this.username = null;
        this.micMuted = false;
        this.cameraMuted = true;
        this.screensharing = false;
        this.participants = new Map(); // id -> { id, name, speaking, micMuted, videoMuted }
        this.dominantSpeaker = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.eventBus.on("JITSI_JOIN_REQUEST", (data) => {
            this.join(data.roomCode, data.username);
        });
        this.eventBus.on("JITSI_LEAVE_REQUEST", () => {
            this.leave();
        });
        this.eventBus.on("JITSI_TOGGLE_MIC", () => {
            this.toggleMic();
        });
        this.eventBus.on("JITSI_TOGGLE_CAMERA", () => {
            this.toggleCamera();
        });
        this.eventBus.on("JITSI_TOGGLE_SCREENSHARE", () => {
            this.toggleScreenshare();
        });
    }

    onStop() {
        this.leave();
    }

    join(roomCode, username) {
        if (this.isJoined || this.api) {
            console.log("[JitsiManager] Already joined or initializing");
            return;
        }

        this.roomCode = roomCode;
        this.username = username;
        this.participants.clear();
        this.dominantSpeaker = null;
        this.screensharing = false;

        const container = document.getElementById("jitsi-iframe-container");
        if (!container) {
            console.error("[JitsiManager] jitsi-iframe-container not found in DOM");
            return;
        }

        const fullRoomName = `VailismWatchParty_${roomCode}`;
        
        console.log(`[JitsiManager] Connecting to Jitsi room: ${fullRoomName}`);
        this.eventBus.emit("JITSI_STATUS_CHANGED", { status: "connecting" });

        try {
            if (typeof window.JitsiMeetExternalAPI === "undefined") {
                console.error("[JitsiManager] JitsiMeetExternalAPI is not loaded.");
                this.eventBus.emit("JITSI_STATUS_CHANGED", { status: "error", error: "Library not loaded" });
                return;
            }

            this.api = new window.JitsiMeetExternalAPI("meet.jit.si", {
                roomName: fullRoomName,
                width: "100%",
                height: "100%",
                parentNode: container,
                userInfo: {
                    displayName: username
                },
                configOverwrite: {
                    startWithAudioMuted: false,
                    startWithVideoMuted: true,
                    prejoinPageEnabled: false,
                    enableWelcomePage: false,
                    disableDeepLinking: true,
                    analytics: { disabled: true }
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: [],
                    SETTINGS_SECTIONS: [],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
                    filmStripOnly: false
                }
            });

            this.isJoined = true;
            this.micMuted = false;
            this.cameraMuted = true;
            this.screensharing = false;

            this.api.addEventListener("videoConferenceJoined", (evt) => {
                console.log("[JitsiManager] Conference Joined", evt);
                this.eventBus.emit("JITSI_STATUS_CHANGED", { status: "connected" });
                this.eventBus.emit("SHOW_TOAST", { message: "Joined voice party!" });
                
                this.api.isAudioMuted().then(muted => {
                    this.micMuted = muted;
                    this.eventBus.emit("JITSI_LOCAL_MUTE_CHANGED", { 
                        micMuted: this.micMuted, 
                        cameraMuted: this.cameraMuted,
                        screensharing: this.screensharing
                    });
                    this.notifyParticipantsChanged();
                });
            });

            this.api.addEventListener("participantJoined", (evt) => {
                console.log("[JitsiManager] Participant joined:", evt);
                this.participants.set(evt.id, {
                    id: evt.id,
                    name: evt.displayName || "Friend",
                    speaking: false,
                    micMuted: false,
                    videoMuted: true
                });
                this.updateContainerVisibility();
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("participantLeft", (evt) => {
                console.log("[JitsiManager] Participant left:", evt);
                this.participants.delete(evt.id);
                if (this.dominantSpeaker === evt.id) {
                    this.dominantSpeaker = null;
                }
                this.updateContainerVisibility();
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("audioMuteStatusChanged", (evt) => {
                if (evt.local) {
                    this.micMuted = evt.muted;
                    this.eventBus.emit("JITSI_LOCAL_MUTE_CHANGED", { 
                        micMuted: this.micMuted, 
                        cameraMuted: this.cameraMuted,
                        screensharing: this.screensharing
                    });
                } else {
                    const p = this.participants.get(evt.id);
                    if (p) {
                        p.micMuted = evt.muted;
                    }
                }
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("videoMuteStatusChanged", (evt) => {
                if (evt.local) {
                    this.cameraMuted = evt.muted;
                    this.eventBus.emit("JITSI_LOCAL_MUTE_CHANGED", { 
                        micMuted: this.micMuted, 
                        cameraMuted: this.cameraMuted,
                        screensharing: this.screensharing
                    });
                    this.updateContainerVisibility();
                } else {
                    const p = this.participants.get(evt.id);
                    if (p) {
                        p.videoMuted = evt.muted;
                    }
                    this.updateContainerVisibility();
                }
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("screenSharingStatusChanged", (evt) => {
                console.log("[JitsiManager] Screensharing status changed:", evt);
                this.screensharing = !!evt.on;
                this.eventBus.emit("JITSI_LOCAL_MUTE_CHANGED", { 
                    micMuted: this.micMuted, 
                    cameraMuted: this.cameraMuted,
                    screensharing: this.screensharing
                });
                this.updateContainerVisibility();
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("dominantSpeakerChanged", (evt) => {
                this.dominantSpeaker = evt.id;
                this.participants.forEach((p, id) => {
                    p.speaking = (id === evt.id);
                });
                
                this.eventBus.emit("JITSI_SPEAKING_CHANGED", {
                    dominantSpeakerId: evt.id,
                    dominantSpeakerName: evt.id === 'local' ? this.username : (this.participants.get(evt.id)?.name || "Someone")
                });
                this.notifyParticipantsChanged();
            });

            this.api.addEventListener("readyToClose", () => {
                this.leave();
            });

        } catch (err) {
            console.error("[JitsiManager] Error starting Jitsi Meet:", err);
            this.eventBus.emit("JITSI_STATUS_CHANGED", { status: "error", error: err.message });
        }
    }

    leave() {
        if (!this.api) return;
        
        console.log("[JitsiManager] Leaving Jitsi Meet");
        try {
            this.api.executeCommand("hangup");
            this.api.dispose();
        } catch (e) {
            console.error("[JitsiManager] Error disposing API:", e);
        }
        
        this.api = null;
        this.isJoined = false;
        this.participants.clear();
        this.dominantSpeaker = null;
        this.screensharing = false;

        const container = document.getElementById("jitsi-iframe-container");
        if (container) {
            container.style.display = "none";
            container.innerHTML = "";
        }

        this.eventBus.emit("JITSI_STATUS_CHANGED", { status: "disconnected" });
        this.eventBus.emit("JITSI_SPEAKING_CHANGED", { dominantSpeakerId: null, dominantSpeakerName: null });
        this.eventBus.emit("SHOW_TOAST", { message: "Left voice party." });
        this.notifyParticipantsChanged();
    }

    toggleMic() {
        if (!this.api) return;
        this.api.executeCommand("toggleAudio");
    }

    toggleCamera() {
        if (!this.api) return;
        this.api.executeCommand("toggleVideo");
    }

    toggleScreenshare() {
        if (!this.api) return;
        this.api.executeCommand("toggleShareScreen");
    }

    updateContainerVisibility() {
        const container = document.getElementById("jitsi-iframe-container");
        if (!container) return;
        
        const show = !this.cameraMuted || this.screensharing || Array.from(this.participants.values()).some(p => !p.videoMuted);
        container.style.display = show ? "block" : "none";
    }

    notifyParticipantsChanged() {
        this.eventBus.emit("JITSI_PARTICIPANTS_CHANGED", {
            count: this.participants.size + (this.isJoined ? 1 : 0),
            participants: Array.from(this.participants.values()),
            local: {
                name: this.username,
                micMuted: this.micMuted,
                cameraMuted: this.cameraMuted,
                screensharing: this.screensharing,
                speaking: this.dominantSpeaker === 'local'
            }
        });
    }
}
