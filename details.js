document.addEventListener('DOMContentLoaded', async () => {
    // ── Guard: only run on the details page ──────────────────────────────────
    if (!document.getElementById('details-view')) return;

    const urlParams = new URLSearchParams(window.location.search);
    const id        = urlParams.get('id');
    let   type      = urlParams.get('type') || 'movie';

    // ── Missing ID → redirect home ────────────────────────────────────────────
    if (!id) {
        window.location.href = 'index.html';
        return;
    }

    // ── DOM refs (all guarded, null-safe) ─────────────────────────────────────
    const heroHeader = document.getElementById('details-hero');
    const titleEl    = document.getElementById('details-title');
    const descEl     = document.getElementById('details-desc');
    const metaEl     = document.getElementById('details-meta');
    const playBtn    = document.getElementById('details-play');

    const FALLBACK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // ── Session cache helpers (shared with script.js) ──────────────────────────
    const SESSION_CACHE_TTL = 30 * 60 * 1000;
    function sessionCacheGet(key) {
        try {
            const raw = sessionStorage.getItem('vc_' + key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (Date.now() - entry.ts > SESSION_CACHE_TTL) {
                sessionStorage.removeItem('vc_' + key);
                return null;
            }
            return entry.data;
        } catch (e) { return null; }
    }
    function sessionCacheSet(key, data) {
        try {
            sessionStorage.setItem('vc_' + key, JSON.stringify({ data: data, ts: Date.now() }));
        } catch (e) {}
    }

    // ── TMDB fetch with session cache ──────────────────────────────────────────
    async function fetchApi(path) {
        // Check session cache first (data may already exist from index page)
        const cacheKey = 'detail_' + path.replace(/^\//,'').replace(/\//g, '_');
        const cached = sessionCacheGet(cacheKey);
        if (cached) return cached;

        const res = await fetch(`/api/tmdb?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
        const data = await res.json();
        if (data && typeof data === 'object') {
            sessionCacheSet(cacheKey, data);
        }
        return data;
    }

    // ── Show error state without crashing ────────────────────────────────────
    function showError(msg) {
        if (titleEl) {
            titleEl.textContent = 'Unable to Load';
            titleEl.classList.remove('skeleton-text');
        }
        if (descEl) {
            descEl.textContent = msg || 'Something went wrong. Please try again.';
            descEl.classList.remove('skeleton-text');
        }
    }

    try {
        // ── Fetch details (with type-flip fallback) ───────────────────────────
        let details = null;
        try {
            details = await fetchApi(`/${type}/${id}`);
        } catch (e) {
            console.warn(`[VAILISM] Initial fetch failed (type=${type}). Trying opposite type…`);
            type    = type === 'movie' ? 'tv' : 'movie';
            details = await fetchApi(`/${type}/${id}`);
        }

        if (!details || typeof details !== 'object') {
            throw new Error('Empty response from API');
        }

        // Cache this details object for player.html to pick up
        sessionCacheSet('detail_' + type + '_' + id, details);

        // ── Background image ──────────────────────────────────────────────────
        if (heroHeader) {
            const bg = details.backdrop_path || details.poster_path;
            if (bg) {
                heroHeader.style.backgroundImage = `url(https://image.tmdb.org/t/p/original${bg})`;
            } else {
                heroHeader.style.backgroundImage = 'none';
                heroHeader.style.backgroundColor = '#141414';
            }
        }

        // ── Title & description ───────────────────────────────────────────────
        if (titleEl) {
            titleEl.textContent = details.title || details.name || 'Details';
            titleEl.classList.remove('skeleton-text');
        }
        if (descEl) {
            descEl.textContent = details.overview || 'No description available.';
            descEl.classList.remove('skeleton-text');
        }

        // ── Metadata ──────────────────────────────────────────────────────────
        const year   = (details.release_date || details.first_air_date || '').split('-')[0];
        const rating = details.vote_average
            ? ((details.vote_average * 10).toFixed(0) + '% Match')
            : '';

        const yearEl    = document.getElementById('details-year');
        const ratingEl  = document.getElementById('details-rating');
        const runtimeEl = document.getElementById('details-runtime');

        if (yearEl)   yearEl.textContent   = year;
        if (ratingEl) ratingEl.textContent = rating;

        if (runtimeEl) {
            if (type === 'movie' && details.runtime) {
                runtimeEl.textContent = `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m`;
            } else if (type === 'tv' && details.number_of_seasons) {
                runtimeEl.textContent = `${details.number_of_seasons} Season${details.number_of_seasons > 1 ? 's' : ''}`;
            } else if (type === 'tv' && details.episode_run_time && details.episode_run_time.length > 0) {
                runtimeEl.textContent = `${details.episode_run_time[0]}m`;
            }
        }

        if (metaEl) metaEl.style.opacity = '1';

        // ── Genres ────────────────────────────────────────────────────────────
        const genresEl = document.getElementById('details-genres');
        if (genresEl && details.genres && details.genres.length > 0) {
            genresEl.innerHTML = details.genres
                .map(g => `<span>${g.name}</span>`)
                .join('<span class="dot">•</span>');
        }

        // ── Play button ───────────────────────────────────────────────────────
        if (playBtn) {
            playBtn.style.display = 'flex';
            // .onclick replacement prevents listener stacking
            playBtn.onclick = () => window.playMovie(id, type);
        }

        // ── Watchlist Button ──────────────────────────────────────────────────
        const watchlistBtn = document.getElementById('details-watchlist-btn');
        if (watchlistBtn) {
            watchlistBtn.style.display = 'flex';
            
            // Helper to get watchlist array
            const getWatchlist = async () => {
                const list = await lsGet('vailism_watchlist');
                return (list && Array.isArray(list.items)) ? list.items : [];
            };
            
            // Update button UI state
            const updateWatchlistBtnUI = async () => {
                const list = await getWatchlist();
                const inList = list.some(item => String(item.id) === String(id) && item.mediaType === type);
                
                if (inList) {
                    watchlistBtn.classList.add('in-list');
                    watchlistBtn.innerHTML = '<i data-lucide="check"></i> In My List';
                } else {
                    watchlistBtn.classList.remove('in-list');
                    watchlistBtn.innerHTML = '<i data-lucide="plus"></i> My List';
                }
                if (window.lucide) window.lucide.createIcons();
            };
            
            updateWatchlistBtnUI();

            // Sync UI across tabs
            try {
                const bc = new BroadcastChannel('vailism_sync');
                bc.onmessage = (event) => {
                    if (event.data && event.data.type === 'UPDATE' && event.data.key === 'vailism_watchlist') {
                        updateWatchlistBtnUI();
                    }
                };
            } catch(e) {}
            
            // BFCache recovery
            window.addEventListener('pageshow', (event) => {
                if (event.persisted) {
                    updateWatchlistBtnUI();
                }
            });
            
            watchlistBtn.onclick = async (e) => {
                e.stopPropagation();
                // Throttle clicks to avoid storage spam
                watchlistBtn.style.pointerEvents = 'none';
                setTimeout(() => { watchlistBtn.style.pointerEvents = 'auto'; }, 600);
                
                let list = await getWatchlist();
                const index = list.findIndex(item => String(item.id) === String(id) && item.mediaType === type);
                
                if (index > -1) {
                    list.splice(index, 1);
                } else {
                    list.push({ id: parseInt(id, 10), mediaType: type, addedAt: Date.now() });
                }
                
                await lsSet('vailism_watchlist', { version: 1, items: list });
                updateWatchlistBtnUI();
            };
        }

        // ── Trailer Button and Modal ──────────────────────────────────────────
        const trailerBtn = document.getElementById('details-trailer-btn');
        const trailerModal = document.getElementById('trailer-modal');
        const trailerCloseBtn = document.getElementById('trailer-close-btn');
        const trailerPlayerContainer = document.getElementById('trailer-player-container');
        
        if (trailerBtn && trailerModal && trailerPlayerContainer) {
            let trailerKey = null;
            
            // Fetch videos asynchronously in the background
            (async () => {
                try {
                    const videoData = await fetchApi(`/${type}/${id}/videos`);
                    if (videoData && videoData.results && videoData.results.length > 0) {
                        // Find a YouTube trailer, teaser, or clip
                        const trailer = videoData.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser' || v.type === 'Clip'));
                        if (trailer && trailer.key) {
                            trailerKey = trailer.key;
                            trailerBtn.style.display = 'flex';
                            if (window.lucide) window.lucide.createIcons();
                        }
                    }
                } catch (err) {
                    console.warn('[VAILISM] Failed to load trailer videos:', err);
                }
            })();
            
            const closeTrailer = () => {
                trailerModal.classList.remove('show');
                trailerModal.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
                // Destroy iframe to stop audio
                trailerPlayerContainer.innerHTML = '';
                // Remove Esc listener
                document.removeEventListener('keydown', handleTrailerEsc);
            };
            
            const handleTrailerEsc = (e) => {
                if (e.key === 'Escape') closeTrailer();
            };
            
            trailerBtn.onclick = (e) => {
                e.stopPropagation();
                if (!trailerKey) return;
                
                // Inject iframe
                trailerPlayerContainer.innerHTML = `
                    <iframe class="trailer-iframe" 
                            src="https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&enablejsapi=1&rel=0" 
                            allow="autoplay; encrypted-media" 
                            allowfullscreen></iframe>`;
                
                trailerModal.classList.add('show');
                trailerModal.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';
                
                // Bind Esc key to close
                document.addEventListener('keydown', handleTrailerEsc);
                
                // Close button trigger
                if (trailerCloseBtn) {
                    trailerCloseBtn.onclick = (ev) => {
                        ev.stopPropagation();
                        closeTrailer();
                    };
                }
                
                // Click outside trailer container to close
                trailerModal.onclick = (ev) => {
                    if (ev.target === trailerModal) {
                        closeTrailer();
                    }
                };
            };
        }

        // ── Cast Gallery ──────────────────────────────────────────────────────
        const castSection = document.getElementById('cast-section');
        const castPosters = document.getElementById('cast-posters');
        
        if (castSection && castPosters) {
            // Lazy load cast gallery when scrolled near viewport
            const castObserver = new IntersectionObserver((entries, observer) => {
                if (entries[0].isIntersecting) {
                    observer.unobserve(castSection);
                    loadCastGallery();
                }
            }, { rootMargin: '0px 0px 400px 0px' });
            
            castObserver.observe(castSection);
            
            async function loadCastGallery() {
                try {
                    const creditsData = await fetchApi(`/${type}/${id}/credits`);
                    if (creditsData && creditsData.cast && creditsData.cast.length > 0) {
                        castPosters.innerHTML = '';
                        castSection.classList.remove('hidden');
                        
                        // Limit to top 10 cast members
                        const topCast = creditsData.cast.slice(0, 10);
                        
                        topCast.forEach(member => {
                            const card = document.createElement('div');
                            card.className = 'cast-card';
                            
                            const name = member.name.replace(/"/g, '&quot;');
                            const character = (member.character || '').replace(/"/g, '&quot;');
                            
                            let avatarHTML = '';
                            if (member.profile_path) {
                                avatarHTML = `<img class="cast-avatar" src="https://image.tmdb.org/t/p/w185${member.profile_path}" alt="${name}" loading="lazy" decoding="async" width="185" height="278">`;
                            } else {
                                // Initials placeholder
                                const initials = member.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                                avatarHTML = `<div class="cast-avatar-placeholder">${initials}</div>`;
                            }
                            
                            card.innerHTML = `
                                ${avatarHTML}
                                <div class="cast-name" title="${name}">${name}</div>
                                <div class="cast-character" title="${character}">${character}</div>
                            `;
                            castPosters.appendChild(card);
                        });
                    }
                } catch (err) {
                    console.warn('[VAILISM] Failed to load cast credits:', err);
                }
            }
        }

        // ── TV: Episodes section ──────────────────────────────────────────────
        if (type === 'tv' && details.seasons && details.seasons.length > 0) {
            const epBtn         = document.getElementById('details-episodes-btn');
            const epSection     = document.getElementById('episodes-section');
            const seasonSelect  = document.getElementById('season-select');

            if (epBtn)     epBtn.style.display = 'flex';
            if (epSection) epSection.classList.remove('hidden');

            if (seasonSelect) {
                details.seasons.forEach(season => {
                    if (season.season_number < 1) return; // skip specials
                    const opt    = document.createElement('option');
                    opt.value    = season.season_number;
                    opt.textContent = season.name || `Season ${season.season_number}`;
                    seasonSelect.appendChild(opt);
                });

                const loadEpisodes = async (seasonNum) => {
                    const epList = document.getElementById('episodes-list');
                    if (!epList) return;
                    epList.innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">Loading episodes…</div>';

                    try {
                        const seasonData = await fetchApi(`/tv/${id}/season/${seasonNum}`);
                        epList.innerHTML = '';

                        if (!seasonData.episodes || seasonData.episodes.length === 0) {
                            epList.innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">No episodes found.</div>';
                            return;
                        }

                        seasonData.episodes.forEach(ep => {
                            const epCard = document.createElement('div');
                            epCard.className = 'episode-card';
                            // Single onclick — no stacking
                            epCard.onclick = () => window.playMovie(id, type, seasonNum, ep.episode_number);

                            const imgSrc = ep.still_path
                                ? `https://image.tmdb.org/t/p/w342${ep.still_path}`
                                : FALLBACK_IMG;
                            const epName = (ep.name || '').replace(/"/g, '&quot;');

                            epCard.innerHTML = `
                                <div class="ep-img">
                                    <img src="${imgSrc}"
                                         alt="${epName}"
                                         loading="lazy"
                                         decoding="async"
                                         onerror="this.src='${FALLBACK_IMG}'">
                                    <div class="play-icon">
                                        <i data-lucide="play" fill="currentColor" size="16"></i>
                                    </div>
                                </div>
                                <div class="ep-info">
                                    <div class="ep-title">
                                        <span>${ep.episode_number}. ${ep.name || 'Episode'}</span>
                                        <span class="ep-runtime">${ep.runtime || '--'}m</span>
                                    </div>
                                    <p class="ep-desc">
                                        ${ep.overview || 'No description available for this episode.'}
                                    </p>
                                </div>`;

                            epList.appendChild(epCard);
                        });

                        if (window.lucide) window.lucide.createIcons();
                    } catch (e) {
                        const epList2 = document.getElementById('episodes-list');
                        if (epList2) {
                            epList2.innerHTML = '<div style="color:#ff4444;padding:20px 0;">Failed to load episodes. Please try again.</div>';
                        }
                    }
                };

                // Use onchange (no stacking risk)
                seasonSelect.onchange = e => loadEpisodes(e.target.value);

                const firstValid = details.seasons.find(s => s.season_number > 0) || details.seasons[0];
                if (firstValid) {
                    seasonSelect.value = firstValid.season_number;
                    loadEpisodes(firstValid.season_number);
                }
            }
        }

        // ── Similar Titles ────────────────────────────────────────────────────
        const similarContainer = document.getElementById('similar-posters');
        if (similarContainer) {
            similarContainer.innerHTML = ''; // clear skeletons

            let similarMovies = [];
            try {
                const simData  = await fetchApi(`/${type}/${id}/similar`);
                similarMovies  = (simData && simData.results) ? simData.results : [];
            } catch (e) {
                // Similar titles are non-critical; fail silently
            }

            if (similarMovies.length > 0) {
                similarMovies.forEach(movie => {
                    if (!movie.poster_path && !movie.backdrop_path) return;

                    const cardType = movie.media_type || type;
                    const img      = movie.poster_path || movie.backdrop_path;
                    const altText  = (movie.title || movie.name || 'Movie').replace(/"/g, '&quot;');

                    const card = document.createElement('div');
                    card.className  = 'card';
                    card.dataset.id = String(movie.id);
                    card.onclick    = () => window.location.href =
                        `details.html?id=${movie.id}&type=${cardType}`;

                    card.innerHTML = `
                        <img src="https://image.tmdb.org/t/p/w342${img}"
                             alt="${altText}"
                             loading="lazy"
                             decoding="async"
                             style="aspect-ratio:2/3;object-fit:cover;"
                             onerror="this.src='${FALLBACK_IMG}'">
                        <div class="card-overlay">
                            <span style="font-weight:600;font-size:14px;
                                         text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                                ${movie.title || movie.name || ''}
                            </span>
                            <div class="play-icon"
                                 onclick="event.stopPropagation();
                                          window.playMovie('${movie.id}','${cardType}')">
                                <i data-lucide="play" fill="currentColor" size="16"></i>
                            </div>
                        </div>`;

                    similarContainer.appendChild(card);
                });
                if (window.lucide) window.lucide.createIcons();
            } else {
                similarContainer.innerHTML =
                    '<p style="color:var(--text-muted);padding:20px;">No similar titles found.</p>';
            }
        }

    } catch (e) {
        console.error('[VAILISM] details.js fatal error:', e);
        showError('Failed to load details. Please go back and try again.');
    }
});
