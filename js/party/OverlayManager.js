/**
 * @file OverlayManager.js
 * @description Manages glassmorphic panel displays, layout updates, and parent-wrapper fullscreen locks.
 */
export class OverlayManager {
    /**
     * @param {HTMLElement} sidebarElement Collapsible sidebar node
     * @param {HTMLElement} toggleButton Bubble toggle button selector
     * @param {HTMLElement} rootWrapper Outer parent container wrapper
     */
    constructor(sidebarElement, toggleButton, rootWrapper) {
        this.sidebar = sidebarElement;
        this.toggleBtn = toggleButton;
        this.root = rootWrapper;
        this.listeners = [];

        this._bindEvents();
    }

    _bindEvents() {
        // Toggle Panel Handler
        const handleToggle = () => this.toggleSidebar();
        this.toggleBtn?.addEventListener("click", handleToggle);
        this.listeners.push({ target: this.toggleBtn, type: "click", fn: handleToggle });

        // Fullscreen Change Listeners
        const handleFs = () => this._onFullscreenChange();
        document.addEventListener("fullscreenchange", handleFs);
        document.addEventListener("webkitfullscreenchange", handleFs);
        this.listeners.push({ target: document, type: "fullscreenchange", fn: handleFs });
        this.listeners.push({ target: document, type: "webkitfullscreenchange", fn: handleFs });
    }

    /**
     * Collapses or reveals the watch party controls sidebar.
     */
    toggleSidebar() {
        if (!this.sidebar) return;
        
        const isCollapsed = this.sidebar.classList.toggle("collapsed");
        if (isCollapsed) {
            this.toggleBtn?.classList.remove("hidden");
        } else {
            this.toggleBtn?.classList.add("hidden");
        }
    }

    /**
     * Toggles fullscreen locks on the wrapper node instead of the player iframe.
     */
    toggleFullscreen() {
        if (!this.root) return;

        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            const requestFS = this.root.requestFullscreen || this.root.webkitRequestFullscreen;
            if (requestFS) {
                requestFS.call(this.root).catch(err => {
                    console.error("[OverlayManager] Fullscreen request rejected:", err);
                });
            }
        } else {
            const exitFS = document.exitFullscreen || document.webkitExitFullscreen;
            if (exitFS) {
                exitFS.call(document);
            }
        }
    }

    _onFullscreenChange() {
        const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
        this.root?.classList.toggle("fullscreen-active", isFull);
    }

    /**
     * Clears all layout event handlers.
     */
    destroy() {
        this.listeners.forEach(({ target, type, fn }) => {
            target?.removeEventListener(type, fn);
        });
        this.listeners = [];
        this.sidebar = null;
        this.toggleBtn = null;
        this.root = null;
    }
}
