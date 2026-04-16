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

    // ── Safe TMDB fetch ───────────────────────────────────────────────────────
    async function fetchApi(path) {
        const res = await fetch(`/api/tmdb?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
        return res.json();
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
                            epCard.onclick = () => window.playMovie(id, type);

                            const imgSrc = ep.still_path
                                ? `https://image.tmdb.org/t/p/w342${ep.still_path}`
                                : FALLBACK_IMG;
                            const epName = (ep.name || '').replace(/"/g, '&quot;');

                            epCard.innerHTML = `
                                <div class="ep-img">
                                    <img src="${imgSrc}"
                                         alt="${epName}"
                                         loading="lazy"
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
