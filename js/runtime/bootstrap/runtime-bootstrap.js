import { RuntimeKernel } from '../core/RuntimeKernel.js';
import { EventBus } from '../core/EventBus.js';
import { RuntimeLogger } from '../core/RuntimeLogger.js';
import { MetricsStore } from '../core/MetricsStore.js';
import { PlaybackStateMachine } from '../core/StateMachine.js';
import { FailureIsolation } from '../recovery/FailureIsolation.js';
import { SocketManager } from '../networking/SocketManager.js';
import { PresenceManager } from '../networking/PresenceManager.js';
import { ConnectionQualityMonitor } from '../networking/ConnectionQualityMonitor.js';
import { ProviderHealthMonitor } from '../provider/ProviderHealthMonitor.js';
import { SyncConfidenceManager } from '../sync/SyncConfidenceManager.js';
import { SnapshotManager } from '../sync/SnapshotManager.js';
import { DriftController } from '../sync/DriftController.js';
import { HeartbeatManager } from '../sync/HeartbeatManager.js';
import { SyncEngine } from '../sync/SyncEngine.js';
import { Watchdog } from '../recovery/Watchdog.js';
import { ReconnectManager } from '../recovery/ReconnectManager.js';
import { RecoveryManager } from '../recovery/RecoveryManager.js';
import { ToastManager } from '../ui/ToastManager.js';
import { StatusRenderer } from '../ui/StatusRenderer.js';
import { PresenceRenderer } from '../ui/PresenceRenderer.js';
import { OverlayManager } from '../ui/OverlayManager.js';
import { HudRenderer } from '../ui/HudRenderer.js';

window.startModularWatchTogether = async function (isHost, inputPartyId, userName, videoId, videoType, playerWrapper) {
    console.log("[Bootstrap] Initializing modular Watch Together runtime...");
    const kernel = new RuntimeKernel();
    
    // Core Services
    const eventBus = new EventBus();
    kernel.register("eventBus", eventBus);
    kernel.register("logger", new RuntimeLogger());
    kernel.register("metrics", new MetricsStore());
    kernel.register("fsm", new PlaybackStateMachine());
    kernel.register("recovery.failureIsolation", new FailureIsolation());
    
    // Networking Services
    const socket = new SocketManager();
    kernel.register("socket", socket);
    
    const presence = new PresenceManager();
    presence.username = userName;
    kernel.register("network.presence", presence);
    kernel.register("network.quality", new ConnectionQualityMonitor());
    kernel.register("provider.health", new ProviderHealthMonitor());
    
    // Playback Sync Services
    kernel.register("sync.confidence", new SyncConfidenceManager());
    kernel.register("sync.snapshots", new SnapshotManager());
    kernel.register("sync.drift", new DriftController());
    kernel.register("sync.heartbeats", new HeartbeatManager());
    
    const syncEngine = new SyncEngine(playerWrapper);
    kernel.register("sync", syncEngine);
    
    // Recovery Services
    kernel.register("recovery.watchdog", new Watchdog());
    
    const reconnect = new ReconnectManager();
    kernel.register("recovery.reconnect", reconnect);
    kernel.register("recovery", new RecoveryManager());
    
    // UI Renderers
    kernel.register("ui.toast", new ToastManager());
    kernel.register("ui.status", new StatusRenderer());
    kernel.register("ui.presence", new PresenceRenderer());
    kernel.register("ui.overlay", new OverlayManager());
    kernel.register("ui.hud", new HudRenderer());

    // Inject parameters
    socket.isHost = isHost;
    
    // Bind globally for fallback/legacy updates
    window.VailRuntime = kernel;
    window._vailRuntimeBooted = true;

    // Boot subsystems topological sequence
    await kernel.boot();

    // Trigger Socket.io connect and rooms handshake
    const targetRoomId = inputPartyId || ('vail-' + Math.random().toString(36).substr(2, 9));
    reconnect.setRoomContext(targetRoomId, userName);

    socket.connect(userName, () => {
        if (isHost) {
            socket.createRoom(videoId, videoType, userName, (res) => {
                if (res && !res.error) {
                    reconnect.setRoomContext(res.roomId, userName);
                    if (typeof window.setupShareLink === "function") {
                        window.setupShareLink(res.roomId);
                    }
                }
            });
        } else {
            socket.joinRoom(targetRoomId, userName, (res) => {
                if (res && !res.error) {
                    if (typeof window.setupShareLink === "function") {
                        window.setupShareLink(targetRoomId);
                    }
                }
            });
        }
    });

    // Set up backwards compatible global toasts
    window.showToast = (msg) => eventBus.emit("SHOW_TOAST", { message: msg });
    
    return kernel;
};
