export class PresenceManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.participants = new Map();
        this.activeTypers = new Map();
        this.isLocallyTyping = false;
        this.localTypingTimeout = null;
        this.hostId = null;
        this.isHost = false;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.participants.clear();
        this.activeTypers.clear();
        this.isLocallyTyping = false;
        this.hostId = null;
        this.isHost = false;

        this.eventBus.on("SOCKET_CONNECTED", () => {
            this.participants.clear();
            this.activeTypers.clear();
        });

        this.eventBus.on("SOCKET_DISCONNECTED", () => {
            this.activeTypers.forEach(typer => {
                try {
                    clearTimeout(typer.timeout);
                } catch(e) {}
            });
            this.activeTypers.clear();
            this.eventBus.emit("TYPING_UPDATED", { activeTypers: this.activeTypers });
        });

        this.eventBus.on("HOST_CHANGED_RECEIVED", (data) => {
            try {
                const socket = this.kernel.get("socket");
                this.isHost = (data.hostId === socket.getSocketId());
                this.hostId = data.hostId;
                this.updateParticipants(data.participants);
            } catch (e) {
                console.error("[PresenceManager] Error in host-changed handler:", e);
            }
        });

        this.eventBus.on("USER_JOINED_RECEIVED", (data) => {
            this.updateParticipants(data.participants);
        });

        this.eventBus.on("USER_LEFT_RECEIVED", (data) => {
            this.updateParticipants(data.participants);
            
            // Clean up typing indicator if they left
            if (this.activeTypers.has(data.socketId)) {
                clearTimeout(this.activeTypers.get(data.socketId).timeout);
                this.activeTypers.delete(data.socketId);
                this.eventBus.emit("TYPING_UPDATED", { activeTypers: this.activeTypers });
            }
        });

        this.eventBus.on("REMOTE_TYPING_RECEIVED", (data) => {
            this.handleRemoteTyping(data);
        });
    }

    onStop() {
        if (this.localTypingTimeout) clearTimeout(this.localTypingTimeout);
        this.activeTypers.forEach(typer => {
            try {
                clearTimeout(typer.timeout);
            } catch(e) {}
        });
        this.participants.clear();
        this.activeTypers.clear();
    }

    updateParticipants(participantsList) {
        this.participants.clear();
        participantsList.forEach(p => {
            this.participants.set(p.socketId, { id: p.socketId, displayName: p.name });
        });
        this.eventBus.emit("PRESENCE_UPDATED", {
            participants: this.participants,
            hostId: this.hostId,
            isHost: this.isHost
        });
    }

    handleRemoteTyping(data) {
        const { senderId, senderName, isTyping } = data;
        
        if (this.activeTypers.has(senderId)) {
            clearTimeout(this.activeTypers.get(senderId).timeout);
            this.activeTypers.delete(senderId);
        }

        if (isTyping) {
            const timeout = setTimeout(() => {
                try {
                    this.activeTypers.delete(senderId);
                    this.eventBus.emit("TYPING_UPDATED", { activeTypers: this.activeTypers });
                } catch(e) {}
            }, 4000);

            this.activeTypers.set(senderId, { name: senderName, timeout });
        }

        this.eventBus.emit("TYPING_UPDATED", { activeTypers: this.activeTypers });
    }

    handleLocalTyping(isTyping) {
        try {
            const socket = this.kernel.get("socket");
            if (!socket.isConnected()) return;

            if (isTyping) {
                if (!this.isLocallyTyping) {
                    this.isLocallyTyping = true;
                    socket.emitTyping(true);
                }

                if (this.localTypingTimeout) clearTimeout(this.localTypingTimeout);
                this.localTypingTimeout = setTimeout(() => {
                    this.isLocallyTyping = false;
                    socket.emitTyping(false);
                }, 2000);
            } else {
                this.isLocallyTyping = false;
                if (this.localTypingTimeout) clearTimeout(this.localTypingTimeout);
                socket.emitTyping(false);
            }
        } catch (e) {
            console.error("[PresenceManager] Error updating local typing status:", e);
        }
    }
}
