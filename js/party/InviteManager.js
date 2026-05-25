/**
 * @file InviteManager.js
 * @description Generates invitation share links and encapsulates browser clipboard copying routines.
 */
export class InviteManager {
    /**
     * Generates a fully qualified invite URL.
     * @param {string} movieId Content ID (TMDB)
     * @param {string} mediaType "movie" or "tv"
     * @param {string} roomId Cryptographically secure Room ID
     * @param {URLSearchParams} params Active URLSearchParams for TV queries
     * @returns {string} Fully qualified Invite URL
     */
    static generateInviteUrl(movieId, mediaType, roomId, params) {
        const origin = window.location.origin + window.location.pathname;
        let base = `${origin}?id=${movieId}&type=${mediaType}&partyId=${roomId}`;
        
        if (mediaType === 'tv') {
            const season = params.get('s') || '1';
            const episode = params.get('e') || '1';
            base += `&s=${season}&e=${episode}`;
        }
        return base;
    }

    /**
     * Copies a string to the user's clipboard and handles feedback.
     * @param {HTMLButtonElement} button Copy trigger element
     * @param {string} inviteUrl Invitation link URL to copy
     * @returns {Promise<void>} Resolves when copying completes
     */
    static async copyLink(button, inviteUrl) {
        if (!button || !inviteUrl) return;

        try {
            await navigator.clipboard.writeText(inviteUrl);
            const originalHTML = button.innerHTML;
            
            button.textContent = "Link Copied!";
            button.classList.add("copied");

            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.classList.remove("copied");
            }, 2000);
        } catch (error) {
            console.error("[InviteManager] Failed to copy link to clipboard:", error);
            alert("Could not copy link automatically. Here is the link:\n" + inviteUrl);
        }
    }
}
