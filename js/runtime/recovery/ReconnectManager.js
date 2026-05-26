export class ReconnectManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.reconnectInterval = null;
        this.reconnectCountdown = 5;
        this.roomId = null;
        this.username = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.eventBus.on("SOCKET_DISCONNECTED", () => {
            this.startCountdown();
        });

        this.eventBus.on("SOCKET_CONNECTED", () => {
            this.stopCountdown();
        });
    }

    onStop() {
        this.stopCountdown();
    }

    setRoomContext(roomId, username) {
        this.roomId = roomId;
        this.username = username;
    }

    startCountdown() {
        this.stopCountdown();
        this.reconnectCountdown = 5;
        
        this.reconnectInterval = setInterval(() => {
            try {
                this.reconnectCountdown--;
                this.eventBus.emit("RECONNECT_COUNTDOWN_TICK", { countdown: this.reconnectCountdown });
                
                if (this.reconnectCountdown <= 0) {
                    this.reconnectCountdown = 5;
                    this.eventBus.emit("RECONNECT_ATTEMPT_TRIGGERED");
                }
            } catch (err) {
                console.error("[ReconnectManager] Error in countdown interval:", err);
            }
        }, 1000);
    }

    stopCountdown() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
    }
}
