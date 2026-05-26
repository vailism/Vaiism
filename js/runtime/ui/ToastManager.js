export class ToastManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.eventBus.on("SHOW_TOAST", (data) => {
            this.show(data.message);
        });

        this.eventBus.on("SOCKET_CONNECTED", () => this.show("Connected to sync server"));
        this.eventBus.on("SOCKET_DISCONNECTED", () => this.show("Disconnected. Reconnecting..."));
    }

    onStop() {}

    show(msg) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.toast", "showToast", () => {
            const container = document.getElementById("partyToastContainer");
            if (!container) return;
            const toast = document.createElement("div");
            toast.className = "party-toast";
            toast.textContent = msg;
            container.appendChild(toast);
            
            setTimeout(() => {
                try {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                } catch (err) {
                    console.error("[ToastManager] Error removing toast:", err);
                }
            }, 3000);
        });
    }
}
