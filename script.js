// VAILISM - Netflix Clone Logic

// ─── Constants ───────────────────────────────────────────────────────────────
const BASE_URL      = '/api/tmdb';
const IMG_BASE_URL  = 'https://image.tmdb.org/t/p/w342';
const HERO_IMG_URL  = 'https://image.tmdb.org/t/p/original';
const FALLBACK_IMG  = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ENDPOINTS = [
    { title: 'Trending Now',     path: '/trending/all/week' },
    { title: 'Popular Choices',  path: '/movie/popular' },
    { title: 'Top Rated',        path: '/movie/top_rated' },
    { title: 'Action Hits',      path: '/discover/movie?with_genres=28' },
    { title: 'Comedy Hits',      path: '/discover/movie?with_genres=35' },
    { title: 'Horror',           path: '/discover/movie?with_genres=27' },
    { title: 'Sci-Fi & Fantasy', path: '/discover/movie?with_genres=878' },
    { title: 'Romance',          path: '/discover/movie?with_genres=10749' },
    { title: 'Documentaries',    path: '/discover/movie?with_genres=99' }
];

let globalCategoryIndex = 0;

// ─── Safe localStorage helpers ────────────────────────────────────────────────
// All localStorage access goes through these — never throws, never crashes UI.

function lsGet(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[VAILISM] localStorage read failed for key:', key, e);
        return null;
    }
}

function lsSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('[VAILISM] localStorage write failed for key:', key, e);
    }
}

function lsRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        // ignore
    }
}

function lsKeys() {
    try {
        return Object.keys(localStorage);
    } catch (e) {
        return [];
    }
}

// ─── Progress data validator ──────────────────────────────────────────────────
function isValidProgress(data) {
    if (!data || typeof data !== 'object') return false;
    const ts  = parseFloat(data.timestamp);
    const dur = parseFloat(data.duration);
    return isFinite(ts) && isFinite(dur) && ts > 0 && dur > 0 && ts < dur;
}

// ─── API Cache & Fetch ────────────────────────────────────────────────────────
const apiCache = new Map();

async function fetchMovies(endpoint, page = 1) {
    const cacheKey = `${endpoint}-${page}`;
    if (apiCache.has(cacheKey)) return apiCache.get(cacheKey);

    try {
        const pathBlock   = encodeURIComponent(endpoint.split('?')[0]);
        const paramsBlock = endpoint.includes('?') ? (endpoint.split('?')[1] + '&') : '';
        const res = await fetch(`${BASE_URL}?path=${pathBlock}&${paramsBlock}page=${page}`);

        if (!res.ok) {
            if (res.status === 429) {
                console.warn('[VAILISM] Rate limit reached. Retrying in 1s…');
                await new Promise(r => setTimeout(r, 1000));
                return fetchMovies(endpoint, page);
            }
            throw new Error(`API Error: ${res.status}`);
        }

        const data    = await res.json();
        const results = data.results || [];
        if (results.length > 0) apiCache.set(cacheKey, results);
        return results;
    } catch (e) {
        console.error('[VAILISM] fetchMovies failed:', e);
        return [];
    }
}

// ─── Global actions (called from inline HTML onclick attributes) ──────────────

window.playMovie = function (id, type) {
    if (!id) return;
    type = type || 'movie';
    window.location.href = `player.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;
};

window.toggleMyList = function (movie, btn) {
    if (!movie || !movie.id) return;
    try {
        let myList = lsGet('vailism_mylist') || [];
        if (!Array.isArray(myList)) myList = [];

        const id    = String(movie.id);
        const index = myList.findIndex(m => String(m.id) === id);

        if (index === -1) {
            myList.push(movie);
            if (btn) btn.classList.add('added');
        } else {
            myList.splice(index, 1);
            if (btn) btn.classList.remove('added');
        }

        lsSet('vailism_mylist', myList);
        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.warn('[VAILISM] toggleMyList error:', e);
    }
};

// ─── DOM Ready ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Navbar scroll effect (throttled, null-safe) ───────────────────────────
    const navbar = document.getElementById('navbar');
    if (navbar) {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (scrollTicking) return;
            scrollTicking = true;
            requestAnimationFrame(() => {
                navbar.classList.toggle('scrolled', window.scrollY > 50);
                scrollTicking = false;
            });
        }, { passive: true });
    }

    // ── Hero Banner ───────────────────────────────────────────────────────────
    async function loadHeroBanner() {
        const movies = await fetchMovies('/trending/all/week');
        if (!movies || movies.length === 0) return;

        const baseMovie = movies[Math.floor(Math.random() * Math.min(movies.length, 5))];
        const type      = baseMovie.media_type || (baseMovie.name ? 'tv' : 'movie');

        let movie = baseMovie;
        try {
            const res = await fetch(`/api/tmdb?path=${encodeURIComponent('/' + type + '/' + baseMovie.id)}`);
            if (res.ok) movie = await res.json();
        } catch (e) {
            // Fall back to baseMovie — no crash
        }

        // DOM refs — all guarded
        const heroTitle  = document.getElementById('hero-title');
        const heroDesc   = document.getElementById('hero-desc');
        const heroPlay   = document.getElementById('hero-play');
        const heroInfo   = document.getElementById('hero-info');
        const heroHeader = document.getElementById('hero');
        const heroMeta   = document.getElementById('hero-meta');
        const heroRating = document.getElementById('hero-rating');
        const heroYear   = document.getElementById('hero-year');
        const heroRuntime= document.getElementById('hero-runtime');
        const heroGenres = document.getElementById('hero-genres');

        // Remove skeleton loaders
        if (heroTitle) heroTitle.classList.remove('skeleton-text');
        if (heroDesc)  heroDesc.classList.remove('skeleton-text');

        // Metadata
        const year   = (movie.release_date || movie.first_air_date || '').split('-')[0];
        const rating = movie.vote_average ? ((movie.vote_average * 10).toFixed(0) + '% Match') : '';

        let runtimeText = '';
        if (type === 'movie' && movie.runtime) {
            runtimeText = `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`;
        } else if (type === 'tv' && movie.number_of_seasons) {
            runtimeText = `${movie.number_of_seasons} Season${movie.number_of_seasons > 1 ? 's' : ''}`;
        } else if (type === 'tv' && movie.episode_run_time && movie.episode_run_time.length > 0) {
            runtimeText = `${movie.episode_run_time[0]}m`;
        }

        if (heroRating)  heroRating.textContent  = rating;
        if (heroYear)    heroYear.textContent     = year;
        if (heroRuntime) heroRuntime.textContent  = runtimeText;
        if (heroMeta)    heroMeta.style.opacity   = '1';

        if (heroGenres && movie.genres && movie.genres.length > 0) {
            heroGenres.innerHTML = movie.genres
                .map(g => `<span>${g.name}</span>`)
                .join('<span class="dot">•</span>');
        }

        // Background image
        const heroBg = movie.backdrop_path || movie.poster_path;
        if (heroBg && heroHeader) {
            const bgUrl = `${HERO_IMG_URL}${heroBg}`;
            heroHeader.style.backgroundImage = `url(${bgUrl})`;
        }

        if (heroTitle) heroTitle.textContent = movie.title || movie.name || 'Featured Movie';
        if (heroDesc)  heroDesc.textContent  = movie.overview || 'An amazing movie to watch on VAILISM.';

        // Play button — use onclick (not addEventListener) to automatically replace previous handler
        if (heroPlay) {
            heroPlay.style.display = 'flex';
            heroPlay.onclick = () => window.playMovie(movie.id, type);
        }

        // More Info button
        if (heroInfo) {
            heroInfo.style.display = 'flex';
            heroInfo.onclick = () => window.location.href = `details.html?id=${movie.id}&type=${type}`;
        }

        // My List (hidden by CSS, shown only if button exists in DOM)
        const btnList = document.querySelector('.btn-list');
        if (btnList) {
            btnList.style.display = 'flex';
            const myList = lsGet('vailism_mylist') || [];
            if (Array.isArray(myList) && myList.some(m => String(m.id) === String(movie.id))) {
                btnList.classList.add('added');
            }
            btnList.onclick = () => window.toggleMyList(movie, btnList);
        }

        if (window.lucide) window.lucide.createIcons();
    }

    // ── Card Builder ──────────────────────────────────────────────────────────
    function appendMoviesToContainer(movies, container) {
        if (!container || !movies || movies.length === 0) return;

        const fragment   = document.createDocumentFragment();
        const existingIds = new Set(
            Array.from(container.querySelectorAll('.card'))
                .map(c => c.dataset.id)
                .filter(Boolean)
        );

        movies.forEach(movie => {
            if (!movie.poster_path && !movie.backdrop_path) return;
            if (existingIds.has(String(movie.id))) return;
            existingIds.add(String(movie.id));

            const type = movie.media_type || (movie.name ? 'tv' : 'movie');

            const card = document.createElement('div');
            card.classList.add('card');
            card.dataset.id = String(movie.id);
            // Single onclick — never stacks
            card.onclick = () => window.location.href = `details.html?id=${movie.id}&type=${type}`;

            const imgPath = movie.poster_path || movie.backdrop_path;
            const imgSrc  = imgPath ? `${IMG_BASE_URL}${imgPath}` : FALLBACK_IMG;

            card.innerHTML = `
                <img src="${imgSrc}"
                     alt="${(movie.title || movie.name || 'Movie').replace(/"/g, '&quot;')}"
                     loading="lazy"
                     width="342"
                     height="513"
                     style="aspect-ratio:2/3;object-fit:cover;"
                     onerror="this.src='${FALLBACK_IMG}'">
                <div class="card-info-btn"
                     onclick="event.stopPropagation(); window.location.href='details.html?id=${movie.id}&amp;type=${type}'">
                    <i data-lucide="info" size="14"></i>
                </div>
                <div class="card-overlay">
                    <span style="font-weight:600;font-size:14px;text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                        ${movie.title || movie.name || ''}
                    </span>
                    <div class="play-icon"
                         onclick="event.stopPropagation(); window.playMovie('${movie.id}','${type}')">
                        <i data-lucide="play" fill="currentColor" size="16"></i>
                    </div>
                </div>`;

            fragment.appendChild(card);
        });

        container.appendChild(fragment);
        if (window.lucide) window.lucide.createIcons();
    }

    // ── Horizontal Infinite Scroll ────────────────────────────────────────────
    const horizontalObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const rowSection = entry.target.closest('section.row');
            if (!rowSection) return;
            const rowPosters = rowSection.querySelector('.row-posters');
            if (!rowPosters) return;
            observer.unobserve(entry.target);
            loadNextHorizontalPage(rowPosters, rowSection, observer);
        });
    }, { rootMargin: '0px 300px 0px 0px' });

    async function loadNextHorizontalPage(rowElement, rowSection, activeObserver) {
        if (rowElement.dataset.fetching === 'true') return;
        rowElement.dataset.fetching = 'true';

        const nextPage = (parseInt(rowSection.dataset.page, 10) || 1) + 1;
        rowSection.dataset.page = nextPage;

        const path   = rowSection.dataset.path;
        const movies = await fetchMovies(path, nextPage);

        appendMoviesToContainer(movies, rowElement);
        rowElement.dataset.fetching = '';

        const cards = rowElement.querySelectorAll('.card');
        if (cards.length > 0) activeObserver.observe(cards[cards.length - 1]);
    }

    // ── Row Rendering ─────────────────────────────────────────────────────────
    async function renderRow(categoryDef) {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.page = '1';
        rowSection.dataset.path = categoryDef.path;

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = categoryDef.title;

        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');

        // Skeleton placeholders
        for (let i = 0; i < 6; i++) {
            const sk = document.createElement('div');
            sk.classList.add('card', 'skeleton');
            rowPosters.appendChild(sk);
        }

        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        mainContent.appendChild(rowSection);

        const movies = await fetchMovies(categoryDef.path, 1);
        rowPosters.innerHTML = '';

        if (movies && movies.length > 0) {
            appendMoviesToContainer(movies, rowPosters);
            const cards = rowPosters.querySelectorAll('.card');
            if (cards.length > 0) horizontalObserver.observe(cards[cards.length - 1]);
        } else {
            rowPosters.style.display = 'block';
            rowPosters.innerHTML = `
                <div style="padding:20px;color:#ff4444;background:rgba(229,9,20,0.1);
                            border:1px solid #e50914;border-radius:4px;display:inline-block;">
                    <strong>Backend Offline.</strong><br>
                    Run <code>npm start</code> locally or deploy to Vercel.
                </div>`;
        }
    }

    // ── Continue Watching ─────────────────────────────────────────────────────
    async function loadContinueWatching() {
        const keys = lsKeys().filter(k => k.startsWith('vailism_progress_'));
        if (keys.length === 0) return;

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        const rowSection = document.createElement('section');
        rowSection.classList.add('row');

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = 'Continue Watching';

        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');

        mainContent.insertBefore(rowSection, mainContent.firstChild);
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);

        const fetchPromises = keys.map(async key => {
            // ── Safe data read ──────────────────────────────────────────────
            const savedData = lsGet(key);
            if (!isValidProgress(savedData)) {
                // Stale / corrupted entry — clean up silently
                lsRemove(key);
                return;
            }

            const movieId  = key.replace('vailism_progress_', '');
            const typePath = savedData.mediaType || (savedData.season ? 'tv' : 'movie');
            const ts       = parseFloat(savedData.timestamp);
            const dur      = parseFloat(savedData.duration);

            try {
                const res = await fetch(`/api/tmdb?path=${encodeURIComponent('/' + typePath + '/' + movieId)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (!data || (!data.poster_path && !data.backdrop_path)) return;

                const imgPath        = data.poster_path || data.backdrop_path;
                const percentComplete = Math.min(100, Math.max(0, (ts / dur) * 100));
                const title           = (data.title || data.name || 'Movie').replace(/"/g, '&quot;');

                const card = document.createElement('div');
                card.classList.add('card');
                card.dataset.id = movieId;
                // Single assignment — never stacks
                card.onclick = () => window.location.href =
                    `details.html?id=${movieId}&type=${typePath}`;

                card.innerHTML = `
                    <img src="${IMG_BASE_URL}${imgPath}"
                         alt="${title}"
                         loading="lazy"
                         onerror="this.src='${FALLBACK_IMG}'">
                    <div style="height:4px;width:100%;background:rgba(255,255,255,0.2);
                                position:absolute;bottom:0;left:0;">
                        <div style="height:100%;width:${percentComplete.toFixed(1)}%;
                                    background:var(--primary-red);"></div>
                    </div>
                    <div class="card-info-btn"
                         onclick="event.stopPropagation();
                                  window.location.href='details.html?id=${movieId}&amp;type=${typePath}'">
                        <i data-lucide="info" size="14"></i>
                    </div>
                    <div class="card-overlay">
                        <span style="font-weight:600;font-size:14px;
                                     text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                            ${data.title || data.name || ''}
                        </span>
                        <div class="play-icon"
                             onclick="event.stopPropagation();
                                      window.playMovie('${movieId}','${typePath}')">
                            <i data-lucide="play" fill="currentColor" size="16"></i>
                        </div>
                    </div>`;

                rowPosters.appendChild(card);
                if (window.lucide) window.lucide.createIcons();
            } catch (e) {
                console.warn('[VAILISM] Continue Watching fetch failed for', key, e);
            }
        });

        await Promise.all(fetchPromises);

        // Remove the section entirely if nothing loaded
        if (rowPosters.children.length === 0) {
            rowSection.remove();
        }
    }

    // ── Vertical Infinite Scroll (sentinel-based) ─────────────────────────────
    let isFetchingVertical = false;

    async function loadMoreRows() {
        if (isFetchingVertical) return;
        isFetchingVertical = true;

        for (let i = 0; i < 2; i++) {
            if (globalCategoryIndex < ENDPOINTS.length) {
                await renderRow(ENDPOINTS[globalCategoryIndex]);
                globalCategoryIndex++;
            }
        }

        isFetchingVertical = false;
    }

    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        const sentinel    = document.createElement('div');
        sentinel.id       = 'vertical-sentinel';
        sentinel.style.height = '10px';
        mainContent.after(sentinel);

        const verticalObserver = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) loadMoreRows();
        }, { rootMargin: '0px 0px 500px 0px' });

        verticalObserver.observe(sentinel);
    }

    // ── Search ────────────────────────────────────────────────────────────────
    const searchIcon      = document.querySelector('.search-icon');
    const searchContainer = document.querySelector('.search-container');
    const searchInput     = document.getElementById('search-input');
    const appContent      = document.getElementById('app-content');
    const searchView      = document.getElementById('search-view');
    const searchResults   = document.getElementById('search-results');

    function closeSearch() {
        if (searchContainer) searchContainer.classList.remove('active');
        if (searchInput)     searchInput.value = '';
        if (searchView)      searchView.classList.add('hidden');
        if (appContent)      appContent.classList.remove('hidden');
    }

    if (searchIcon && searchContainer && searchInput) {
        searchIcon.addEventListener('click', () => {
            searchContainer.classList.toggle('active');
            if (searchContainer.classList.contains('active')) {
                searchInput.focus();
            } else {
                closeSearch();
            }
        });
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(null, args), delay);
        };
    }

    async function searchMovies(query) {
        if (!query || !query.trim()) {
            if (searchView)  searchView.classList.add('hidden');
            if (appContent) appContent.classList.remove('hidden');
            return;
        }

        if (appContent) appContent.classList.add('hidden');
        if (searchView) searchView.classList.remove('hidden');

        if (searchResults) {
            searchResults.innerHTML = '';
            for (let i = 0; i < 10; i++) {
                const sk = document.createElement('div');
                sk.classList.add('card', 'skeleton');
                searchResults.appendChild(sk);
            }
        }

        const movies = await fetchMovies(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`, 1);

        if (searchResults) {
            searchResults.innerHTML = '';
            if (!movies || movies.length === 0) {
                searchResults.innerHTML = '<h3 style="color:var(--text-muted);">No results found.</h3>';
                return;
            }
            appendMoviesToContainer(movies, searchResults);
        }
    }

    if (searchInput) {
        const debouncedSearch = debounce(e => searchMovies(e.target.value), 500);
        searchInput.addEventListener('input', debouncedSearch);
    }

    // ── Boot ──────────────────────────────────────────────────────────────────
    if (document.getElementById('hero') && document.getElementById('search-input')) {
        loadHeroBanner();
        loadContinueWatching();
        loadMoreRows();
    }
});
