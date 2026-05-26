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
import { JitsiManager } from '../integrations/JitsiManager.js';

window.startModularWatchTogether = async function (isHost, inputPartyId, userName, videoId, videoType, playerWrapper) {
    console.log("[Bootstrap] Initializing modular Watch Together (beta) runtime...");
    const kernel = new RuntimeKernel();
    
    const targetRoomId = inputPartyId || ('vail-' + Math.random().toString(36).substr(2, 9));
    
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
    kernel.register("jitsi", new JitsiManager());

    // Inject parameters
    socket.isHost = isHost;
    
    // Bind globally for fallback/legacy updates
    window.VailRuntime = kernel;
    window._vailRuntimeBooted = true;

    // Collapsible Voice panel UI
    const voiceHeader = document.getElementById("voiceCollapseHeader");
    const voiceControls = document.getElementById("partyVoiceControls");
    const voiceIcon = document.getElementById("voiceCollapseIcon");
    if (voiceHeader && voiceControls && voiceIcon) {
        let collapsed = false;
        voiceHeader.addEventListener("click", () => {
            collapsed = !collapsed;
            voiceControls.style.maxHeight = collapsed ? "0px" : "500px";
            voiceControls.style.padding = collapsed ? "0px" : "0 20px";
            voiceIcon.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
        });
    }

    // Join / Leave click handlers
    const joinVoiceBtn = document.getElementById("joinVoiceBtn");
    const leaveVoiceBtn = document.getElementById("leaveVoiceBtn");
    const toggleMicBtn = document.getElementById("toggleMicBtn");
    const toggleCameraBtn = document.getElementById("toggleCameraBtn");
    const toggleScreenshareBtn = document.getElementById("toggleScreenshareBtn");

    if (joinVoiceBtn) {
        joinVoiceBtn.addEventListener("click", () => {
            const currentRoomId = reconnect.roomId || targetRoomId;
            eventBus.emit("JITSI_JOIN_REQUEST", { roomCode: currentRoomId, username: userName });
        });
    }

    if (leaveVoiceBtn) {
        leaveVoiceBtn.addEventListener("click", () => {
            eventBus.emit("JITSI_LEAVE_REQUEST");
        });
    }

    if (toggleMicBtn) {
        toggleMicBtn.addEventListener("click", () => {
            eventBus.emit("JITSI_TOGGLE_MIC");
        });
    }

    if (toggleCameraBtn) {
        toggleCameraBtn.addEventListener("click", () => {
            eventBus.emit("JITSI_TOGGLE_CAMERA");
        });
    }

    if (toggleScreenshareBtn) {
        toggleScreenshareBtn.addEventListener("click", () => {
            eventBus.emit("JITSI_TOGGLE_SCREENSHARE");
        });
    }

    // Listen to Jitsi status events to update UI
    eventBus.on("JITSI_STATUS_CHANGED", (data) => {
        const dot = document.getElementById("voiceStatusDot");
        const txt = document.getElementById("voiceStatusText");
        const muteControls = document.getElementById("voiceMuteControls");
        const joinBtn = document.getElementById("joinVoiceBtn");
        const leaveBtn = document.getElementById("leaveVoiceBtn");

        if (data.status === "connected") {
            if (dot) dot.style.background = "#00ff66";
            if (txt) txt.textContent = "Connected";
            if (joinBtn) joinBtn.style.display = "none";
            if (leaveBtn) leaveBtn.style.display = "flex";
            if (muteControls) muteControls.style.display = "flex";
            if (joinBtn) joinBtn.removeAttribute("disabled");
        } else if (data.status === "connecting") {
            if (dot) dot.style.background = "#f5a623";
            if (txt) txt.textContent = "Connecting...";
            if (joinBtn) joinBtn.setAttribute("disabled", "true");
        } else {
            // disconnected or error
            if (dot) dot.style.background = "#ff4444";
            if (txt) txt.textContent = data.error ? `Error: ${data.error}` : "Not Connected";
            if (joinBtn) joinBtn.style.display = "flex";
            if (leaveBtn) leaveBtn.style.display = "none";
            if (muteControls) muteControls.style.display = "none";
            if (joinBtn) joinBtn.removeAttribute("disabled");
        }
    });

    eventBus.on("JITSI_LOCAL_MUTE_CHANGED", (data) => {
        const micBtn = document.getElementById("toggleMicBtn");
        const camBtn = document.getElementById("toggleCameraBtn");
        const screenBtn = document.getElementById("toggleScreenshareBtn");

        if (micBtn) {
            micBtn.textContent = data.micMuted ? "🎤 Unmute Mic" : "🎤 Mute Mic";
            micBtn.style.background = data.micMuted ? "rgba(229, 9, 20, 0.2)" : "rgba(255,255,255,0.1)";
        }
        if (camBtn) {
            camBtn.textContent = data.cameraMuted ? "📷 Turn Camera On" : "📷 Turn Camera Off";
            camBtn.style.background = data.cameraMuted ? "rgba(255,255,255,0.1)" : "rgba(229, 9, 20, 0.2)";
        }
        if (screenBtn) {
            screenBtn.textContent = data.screensharing ? "🖥️ Stop Sharing Screen" : "🖥️ Share Screen";
            screenBtn.style.background = data.screensharing ? "rgba(229, 9, 20, 0.2)" : "rgba(255,255,255,0.1)";
        }
    });

    eventBus.on("JITSI_PARTICIPANTS_CHANGED", (data) => {
        const countSpan = document.getElementById("voiceParticipantCount");
        if (countSpan) {
            countSpan.textContent = data.count;
        }
    });

    // Boot subsystems topological sequence
    await kernel.boot();

    // Trigger Socket.io connect and rooms handshake
    reconnect.setRoomContext(targetRoomId, userName);

    const fsm = kernel.get("fsm");
    fsm.transitionTo("CONNECTING", "Bootstrapping watch-together socket connection");

    socket.connect(userName, () => {
        fsm.transitionTo("JOINING", "Socket connected, joining room");
        if (isHost) {
            socket.createRoom(videoId, videoType, userName, (res) => {
                if (res && !res.error) {
                    reconnect.setRoomContext(res.roomId, userName);
                    fsm.transitionTo("BUFFERING", "Host room created, awaiting playback readiness");
                    if (typeof window.setupShareLink === "function") {
                        window.setupShareLink(res.roomId);
                    }
                }
            });
        } else {
            socket.joinRoom(targetRoomId, userName, (res) => {
                if (res && !res.error) {
                    fsm.transitionTo("BUFFERING", "Guest joined room, buffering stream");
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
