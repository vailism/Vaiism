document.addEventListener('DOMContentLoaded', async () => {
    // Execution protection
    if (!document.getElementById('details-view')) return;

    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    let type = urlParams.get('type') || 'movie';

    if (!id) {
        window.location.href = 'index.html';
        return;
    }

    const heroHeader = document.getElementById('details-hero');
    const titleEl = document.getElementById('details-title');
    const descEl = document.getElementById('details-desc');
    const metaEl = document.getElementById('details-meta');
    const playBtn = document.getElementById('details-play');
    
    // Generic Fetch Wrapper
    async function fetchApi(path) {
        console.log(`Evaluating TMDB API at: ${path}`);
        const res = await fetch(`/api/tmdb?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`API fetch failed HTTP ${res.status}`);
        return await res.json();
    }

    try {
        let details = null;
        
        // Smart fetch logic handling missing or incorrect media_types
        try {
            details = await fetchApi(`/${type}/${id}`);
        } catch (e) {
            console.warn(`Fetch failed for assumed type: ${type}. Attempting cross-reference fallback...`);
            type = type === 'movie' ? 'tv' : 'movie'; // flip type
            details = await fetchApi(`/${type}/${id}`);
        }
        
        console.log("Successfully resolved metadata payload:", details);

        // Hero Image configuration
        if (details.backdrop_path || details.poster_path) {
            const bg = details.backdrop_path || details.poster_path;
            const bgUrl = `https://image.tmdb.org/t/p/original${bg}`;
            
            // Preload
            const preloadLink = document.createElement('link');
            preloadLink.rel = 'preload';
            preloadLink.as = 'image';
            preloadLink.href = bgUrl;
            document.head.appendChild(preloadLink);
            
            heroHeader.style.backgroundImage = `url(${bgUrl})`;
        } else {
            heroHeader.style.backgroundImage = `url(https://via.placeholder.com/1920x1080/1a1a1a/e50914?text=VAILISM)`;
        }

        titleEl.textContent = details.title || details.name || "Details";
        titleEl.classList.remove('skeleton-text');
        
        descEl.textContent = details.overview || "No description available.";
        descEl.classList.remove('skeleton-text');
        
        // Metadata formatting
        const year = details.release_date ? details.release_date.split('-')[0] : (details.first_air_date ? details.first_air_date.split('-')[0] : '');
        document.getElementById('details-year').textContent = year;
        
        const rating = details.vote_average ? (details.vote_average * 10).toFixed(0) + '% Match' : '';
        document.getElementById('details-rating').textContent = rating;
        
        if (type === 'movie' && details.runtime) {
            const hours = Math.floor(details.runtime / 60);
            const mins = details.runtime % 60;
            document.getElementById('details-runtime').textContent = `${hours}h ${mins}m`;
        } else if (type === 'tv' && details.number_of_seasons) {
            document.getElementById('details-runtime').textContent = `${details.number_of_seasons} Season${details.number_of_seasons > 1 ? 's' : ''}`;
        } else if (type === 'tv' && details.episode_run_time && details.episode_run_time.length > 0) {
            document.getElementById('details-runtime').textContent = `${details.episode_run_time[0]}m`;
        }
        metaEl.style.opacity = '1';

        // Genres Map
        const genresEl = document.getElementById('details-genres');
        if (details.genres && details.genres.length > 0) {
            genresEl.innerHTML = details.genres.map(g => `<span>${g.name}</span>`).join('<span class="dot">•</span>');
        }

        playBtn.style.display = 'flex';
        playBtn.onclick = () => window.playMovie(id, type);

        // TV Shows - Episodes List handling
        if (type === 'tv' && details.seasons) {
            document.getElementById('details-episodes-btn').style.display = 'flex';
            document.getElementById('episodes-section').classList.remove('hidden');
            
            const seasonSelect = document.getElementById('season-select');
            details.seasons.forEach(season => {
                if (season.season_number > 0) { // filter out specials safely
                    const option = document.createElement('option');
                    option.value = season.season_number;
                    option.textContent = season.name || `Season ${season.season_number}`;
                    seasonSelect.appendChild(option);
                }
            });

            const loadEpisodes = async (seasonNum) => {
                const epList = document.getElementById('episodes-list');
                epList.innerHTML = '<div style="color:var(--text-muted); padding:20px 0;">Loading episodes...</div>';
                try {
                    const seasonData = await fetchApi(`/tv/${id}/season/${seasonNum}`);
                    epList.innerHTML = '';
                    
                    if(!seasonData.episodes || seasonData.episodes.length === 0) {
                         epList.innerHTML = '<div style="color:var(--text-muted); padding:20px 0;">No episodes found.</div>';
                         return;
                    }

                    seasonData.episodes.forEach(ep => {
                        const epCard = document.createElement('div');
                        epCard.className = 'episode-card';
                        epCard.onclick = () => window.playMovie(id, type);
                        
                        const img = ep.still_path ? `https://image.tmdb.org/t/p/w342${ep.still_path}` : 'https://via.placeholder.com/342x192/1a1a1a/e50914?text=No+Preview';
                        
                        epCard.innerHTML = `
                            <div class="ep-img">
                                <img src="${img}" alt="${ep.name}" loading="lazy">
                                <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                            </div>
                            <div class="ep-info">
                                <div class="ep-title"><span>${ep.episode_number}. ${ep.name}</span> <span class="ep-runtime">${ep.runtime || '--'}m</span></div>
                                <p class="ep-desc">${ep.overview || 'No description available for this episode.'}</p>
                            </div>
                        `;
                        epList.appendChild(epCard);
                    });
                    if (window.lucide) window.lucide.createIcons();
                } catch(e) {
                    epList.innerHTML = '<div style="color:#ff4444; padding:20px 0;">Failed to load episodes.</div>';
                }
            };
            
            seasonSelect.onchange = (e) => loadEpisodes(e.target.value);
            if (details.seasons.length > 0) {
                const firstValidSeason = details.seasons.find(s => s.season_number > 0) || details.seasons[0];
                seasonSelect.value = firstValidSeason.season_number;
                loadEpisodes(firstValidSeason.season_number);
            }
        }

        // Similar Titles Logic
        let similarMovies = [];
        try { 
            const simData = await fetchApi(`/${type}/${id}/similar`);
            similarMovies = simData.results || [];
        } catch(e) {}

        const similarContainer = document.getElementById('similar-posters');
        similarContainer.innerHTML = ''; // wipe skeletons
        
        if (similarMovies.length > 0) {
            similarMovies.forEach(movie => {
                if (!movie.poster_path && !movie.backdrop_path) return;
                const card = document.createElement('div');
                card.className = 'card';
                card.onclick = () => window.location.href = `details.html?id=${movie.id}&type=${movie.media_type || type}`;
                const img = movie.poster_path ? movie.poster_path : movie.backdrop_path;
                card.innerHTML = `
                    <img src="https://image.tmdb.org/t/p/w342${img}" alt="${movie.title || movie.name}" loading="lazy" style="aspect-ratio: 2/3; object-fit: cover;">
                    <div class="card-overlay">
                        <span style="font-weight: 600; font-size: 14px; text-shadow:1px 1px 2px rgba(0,0,0,1); color: white;">
                             ${movie.title || movie.name || ""}
                        </span>
                        <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                    </div>`;
                similarContainer.appendChild(card);
            });
            if (window.lucide) window.lucide.createIcons();
        } else {
            similarContainer.innerHTML = '<p style="color:var(--text-muted); padding: 20px;">No similar titles found.</p>';
        }

    } catch (e) {
        console.error("Failed fetching Details metadata:", e);
        titleEl.textContent = "Error Loading Details";
        titleEl.classList.remove('skeleton-text');
        descEl.textContent = `Error: ${e.message}. Check console for details.`;
        descEl.classList.remove('skeleton-text');
    }
});
