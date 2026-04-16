// VAILISM - Netflix Clone Logic

// Basic Backend Router Setup (Protects API Key)
const BASE_URL = '/api/tmdb'; // Points to Vercel Serverless Function
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/w342'; // Optimal scaling payload replacing heavy w500
const HERO_IMG_URL = 'https://image.tmdb.org/t/p/original';

const ENDPOINTS = [
    { title: "Trending Now", path: "/trending/all/week" },
    { title: "Popular Choices", path: "/movie/popular" },
    { title: "Top Rated", path: "/movie/top_rated" },
    { title: "Action Hits", path: "/discover/movie?with_genres=28" },
    { title: "Comedy Hits", path: "/discover/movie?with_genres=35" },
    { title: "Horror", path: "/discover/movie?with_genres=27" },
    { title: "Sci-Fi & Fantasy", path: "/discover/movie?with_genres=878" },
    { title: "Romance", path: "/discover/movie?with_genres=10749" },
    { title: "Documentaries", path: "/discover/movie?with_genres=99" }
];

let globalCategoryIndex = 0;
let apiKeyErrorShown = false;

// Generic Fetch Function
const apiCache = new Map();

async function fetchMovies(endpoint, page = 1) {
    const cacheKey = `${endpoint}-${page}`;
    if (apiCache.has(cacheKey)) {
        return apiCache.get(cacheKey);
    }

    try {
        const pathBlock = encodeURIComponent(endpoint.split('?')[0]);
        const paramsBlock = endpoint.includes('?') ? (endpoint.split('?')[1] + '&') : '';
        const res = await fetch(`${BASE_URL}?path=${pathBlock}&${paramsBlock}page=${page}`);
        
        // Handle rate limiting gracefully
        if (!res.ok) {
            if(res.status === 429) {
                console.warn("TMDB Rate Limit reached. Waiting...");
                await new Promise(r => setTimeout(r, 1000));
                return fetchMovies(endpoint, page);
            }
            throw new Error(`API Error: ${res.status}`);
        }
        
        const data = await res.json();
        const results = data.results || [];
        // Cache successful requests
        if (results.length > 0) apiCache.set(cacheKey, results); 
        return results;
    } catch (e) {
        console.error('Failed to fetch from API Proxy:', e);
        return [];
    }
}

// Navigate to player
window.playMovie = function(id, type = 'movie') {
    if (!id) return;
    window.location.href = `player.html?id=${id}&type=${type}`;
};

// Start logic when DOM is completely loaded
document.addEventListener('DOMContentLoaded', () => {
    
    // Navbar Effects
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    });

    // Hero Rendering
    async function loadHeroBanner() {
        const movies = await fetchMovies('/trending/all/week');
        if (!movies || movies.length === 0) return;
        
        // Pick a random highly rated movie from the first page
        const baseMovie = movies[Math.floor(Math.random() * Math.min(movies.length, 5))];
        const type = baseMovie.media_type || (baseMovie.name ? 'tv' : 'movie');

        // Fetch FULL details to populate accurate metadata
        let movie = baseMovie;
        try {
            const detailsRes = await fetch(`/api/tmdb?path=/${type}/${baseMovie.id}`);
            if (detailsRes.ok) {
                movie = await detailsRes.json();
            }
        } catch (e) {
            console.error("Failed full details hero fetch");
        }
        
        const heroTitle = document.getElementById('hero-title');
        const heroDesc = document.getElementById('hero-desc');
        const heroPlay = document.getElementById('hero-play');
        const heroHeader = document.getElementById('hero');
        
        // Remove skeletons
        if(heroTitle) heroTitle.classList.remove('skeleton-text');
        if(heroDesc) heroDesc.classList.remove('skeleton-text');
        
        // Populate Meta
        const year = movie.release_date ? movie.release_date.split('-')[0] : (movie.first_air_date ? movie.first_air_date.split('-')[0] : '');
        const rating = movie.vote_average ? (movie.vote_average * 10).toFixed(0) + '% Match' : '';
        
        let runtimeText = '';
        if (type === 'movie' && movie.runtime) {
            const hours = Math.floor(movie.runtime / 60);
            const mins = movie.runtime % 60;
            runtimeText = `${hours}h ${mins}m`;
        } else if (type === 'tv' && movie.number_of_seasons) {
            runtimeText = `${movie.number_of_seasons} Season${movie.number_of_seasons > 1 ? 's' : ''}`;
        } else if (type === 'tv' && movie.episode_run_time && movie.episode_run_time.length > 0) {
            runtimeText = `${movie.episode_run_time[0]}m`;
        }

        if (document.getElementById('hero-rating')) document.getElementById('hero-rating').textContent = rating;
        if (document.getElementById('hero-year')) document.getElementById('hero-year').textContent = year;
        if (document.getElementById('hero-runtime')) document.getElementById('hero-runtime').textContent = runtimeText;
        if (document.getElementById('hero-meta')) document.getElementById('hero-meta').style.opacity = '1';

        if (document.getElementById('hero-genres') && movie.genres) {
            document.getElementById('hero-genres').innerHTML = movie.genres.map(g => `<span>${g.name}</span>`).join('<span class="dot">•</span>');
        }
        
        // Ensure image paths exist to prevent null errors
        const heroBg = movie.backdrop_path ? movie.backdrop_path : movie.poster_path;
        if (heroBg && heroHeader) {
            const bgUrl = `${HERO_IMG_URL}${heroBg}`;
            // Preload critical hero background dynamically
            const preloadLink = document.createElement('link');
            preloadLink.rel = 'preload';
            preloadLink.as = 'image';
            preloadLink.href = bgUrl;
            document.head.appendChild(preloadLink);

            heroHeader.style.backgroundImage = `url(${bgUrl})`;
        }
        
        if (heroTitle) heroTitle.textContent = movie.title || movie.name || "Featured Movie";
        if (heroDesc) heroDesc.textContent = movie.overview || "An amazing movie to watch on VAILISM.";
        
        if (heroPlay) {
            heroPlay.style.display = 'flex';
            heroPlay.onclick = () => playMovie(movie.id, type);
        }
        
        // Set more info button to visible
        const btnInfo = document.querySelector('.btn-info');
        if (btnInfo) {
            btnInfo.style.display = 'flex';
            btnInfo.onclick = () => window.location.href = `details.html?id=${movie.id}&type=${type}`;
        }
        
        if(window.lucide) window.lucide.createIcons();
    }

    // Append movies logic extracting card building
    function appendMoviesToContainer(movies, container) {
        const fragment = document.createDocumentFragment();
        const existingIds = new Set(Array.from(container.querySelectorAll('.card')).map(c => c.dataset.id));

        movies.forEach(movie => {
            if (!movie.poster_path && !movie.backdrop_path) return;
            
            // CRITICAL FIX: Ensure entirely unique elements, skipping exact duplicates
            if (existingIds.has(String(movie.id))) return;
            existingIds.add(String(movie.id));
            
            const type = movie.media_type || (movie.name ? 'tv' : 'movie');
            
            const card = document.createElement('div');
            card.classList.add('card');
            card.dataset.id = movie.id;
            card.onclick = () => playMovie(movie.id, type);
            
            const imgPath = movie.poster_path ? movie.poster_path : movie.backdrop_path;
            const fallbackImg = `onerror="this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'"`
            
            // Use aspect-ratio and width/height to prevent layout shifts
            card.innerHTML = `
                <img src="${imgPath ? IMG_BASE_URL + imgPath : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" alt="${movie.title || movie.name || 'Movie'}" loading="lazy" width="342" height="513" style="aspect-ratio: 2/3; object-fit: cover;" ${fallbackImg}>
                <div class="card-overlay">
                    <span style="font-weight: 600; font-size: 14px; text-shadow:1px 1px 2px rgba(0,0,0,1); color: white;">
                        ${movie.title || movie.name || ""}
                    </span>
                    <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                </div>
            `;
            fragment.appendChild(card);
        });
        
        container.appendChild(fragment);
        if(window.lucide) window.lucide.createIcons();
    }

    // Advanced Horizontal Intersection Scroll
    const horizontalObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const targetCard = entry.target;
                const rowSection = targetCard.closest('section.row');
                const rowPosters = rowSection.querySelector('.row-posters');
                
                // Disconnect to avoid loops while fetching
                observer.unobserve(targetCard);
                loadNextHorizontalPage(rowPosters, rowSection, observer);
            }
        });
    }, { rootMargin: '0px 300px 0px 0px' });

    async function loadNextHorizontalPage(rowElement, rowSection, activeObserver) {
        if (rowElement.dataset.fetching) return;
        rowElement.dataset.fetching = "true";
        
        let nextPage = parseInt(rowSection.dataset.page) + 1;
        rowSection.dataset.page = nextPage;
        
        const path = rowSection.dataset.path;
        const movies = await fetchMovies(path, nextPage);
        
        appendMoviesToContainer(movies, rowElement);
        rowElement.dataset.fetching = "";
        
        // Re-attach observer exactly to the newly loaded final card
        const newlyRenderedCards = rowElement.querySelectorAll('.card');
        if (newlyRenderedCards.length > 0) {
            activeObserver.observe(newlyRenderedCards[newlyRenderedCards.length - 1]);
        }
    }

    // Row Rendering
    async function renderRow(categoryDef) {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return; // Fault tolerance
        
        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.page = "1";
        rowSection.dataset.path = categoryDef.path;

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = categoryDef.title;

        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');
        
        // Initial Skeletons
        for(let i=0; i<6; i++) {
            const skeleton = document.createElement('div');
            skeleton.classList.add('card', 'skeleton');
            rowPosters.appendChild(skeleton);
        }
        
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        mainContent.appendChild(rowSection);

        const movies = await fetchMovies(categoryDef.path, 1);
        
        // Flush skeletons immediately once fetched
        rowPosters.innerHTML = '';
        
        if (movies && movies.length > 0) {
            appendMoviesToContainer(movies, rowPosters);
            // Arm observer to the final nested card exclusively
            const loadedCards = rowPosters.querySelectorAll('.card');
            if (loadedCards.length > 0) horizontalObserver.observe(loadedCards[loadedCards.length - 1]);
        } else {
            rowPosters.style.display = 'block';
            rowPosters.innerHTML = `
                <div style="padding: 20px; color: #ff4444; background: rgba(229, 9, 20, 0.1); border: 1px solid #e50914; border-radius: 4px; display: inline-block;">
                    <strong>Vercel/Node Backend Offline.</strong><br>
                    VAILISM securely hides its API key in the backend.<br>
                    Please start the local server by running <code>npm install && npm start</code> in your terminal, or viewing via Vercel.
                </div>
            `;
        }
    }

    // Continue Watching Row Tracking Engine
    async function loadContinueWatching() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('vailism_progress_'));
        if (keys.length === 0) return;

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;
        
        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.unlimited = "false";

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = "Continue Watching";
        
        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');
        
        // Push row strictly above standard fetching grids
        mainContent.insertBefore(rowSection, mainContent.firstChild);
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        
        // Compile saved videos mapping IDs robustly 
        keys.forEach(async key => {
            try {
                const movieId = key.replace('vailism_progress_', '');
                const savedData = JSON.parse(localStorage.getItem(key));
                const typePath = savedData.season ? 'tv' : 'movie';
                
                const res = await fetch(`/api/tmdb?path=/${typePath}/${movieId}`);
                const data = await res.json();
                
                if (data && (data.poster_path || data.backdrop_path)) {
                    const card = document.createElement('div');
                    card.classList.add('card');
                    card.onclick = () => playMovie(movieId, typePath);
                    
                    const imgPath = data.poster_path || data.backdrop_path;
                    
                    // Render progress bar calculations
                    const percentComplete = (savedData.timestamp / savedData.duration) * 100;
                    
                    card.innerHTML = `
                        <img src="${IMG_BASE_URL}${imgPath}" alt="${data.title || data.name || 'Movie'}">
                        <div style="height:4px;width:100%;background:rgba(255,255,255,0.2);position:absolute;bottom:0px;"><div style="height:100%;width:${percentComplete}%;background:var(--primary-red);"></div></div>
                        <div class="card-overlay">
                            <span style="font-weight: 600; font-size: 14px; text-shadow:1px 1px 2px rgba(0,0,0,1); color: white;">
                                ${data.title || data.name || ""}
                            </span>
                            <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                        </div>
                    `;
                    rowPosters.appendChild(card);
                    if(window.lucide) window.lucide.createIcons();
                }
            } catch (e) {
                // Failsafe cache corruption bypass
            }
        });
    }

    // Vertical Infinite Scroll (Loading new rows)
    let isFetchingVertical = false;
    async function loadMoreRows() {
        if (isFetchingVertical) return;
        isFetchingVertical = true;
        
        for(let i=0; i<2; i++) {
            if (globalCategoryIndex < ENDPOINTS.length) {
                await renderRow(ENDPOINTS[globalCategoryIndex]);
                globalCategoryIndex++;
            }
        }
        
        isFetchingVertical = false;
    }

    // Replace Scroll with IntersectionObserver for better DOM performance
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        const sentinel = document.createElement('div');
        sentinel.id = 'vertical-sentinel';
        sentinel.style.height = '10px';
        mainContent.after(sentinel);

        const verticalObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                loadMoreRows();
            }
        }, { rootMargin: '0px 0px 500px 0px' });

        verticalObserver.observe(sentinel);
    }

    // Setup Search Selectors Inside DOM Load
    const searchIcon = document.querySelector('.search-icon');
    const searchContainer = document.querySelector('.search-container');
    const searchInput = document.getElementById('search-input');
    const appContent = document.getElementById('app-content');
    const searchView = document.getElementById('search-view');
    const searchResults = document.getElementById('search-results');

    // Toggle Search UI safely
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

    function closeSearch() {
        if(searchContainer) searchContainer.classList.remove('active');
        if(searchInput) searchInput.value = '';
        if(searchView) searchView.classList.add('hidden');
        if(appContent) appContent.classList.remove('hidden');
    }

    // Debounce Function
    function debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(null, args), delay);
        };
    }

    async function searchMovies(query) {
        if (!query.trim()) {
            if(searchView) searchView.classList.add('hidden');
            if(appContent) appContent.classList.remove('hidden');
            return;
        }
        
        if(appContent) appContent.classList.add('hidden');
        if(searchView) searchView.classList.remove('hidden');
        if(searchResults) {
            searchResults.innerHTML = '';
            // Add skeletons for search
            for(let i=0; i<10; i++) {
                const skeleton = document.createElement('div');
                skeleton.classList.add('card', 'skeleton');
                searchResults.appendChild(skeleton);
            }
        }
        
        const url = `/search/multi?query=${encodeURIComponent(query)}&include_adult=false`;
        const movies = await fetchMovies(url, 1);
        
        if (searchResults) {
            searchResults.innerHTML = '';
            if (movies.length === 0) {
                searchResults.innerHTML = '<h3 style="color:var(--text-muted);">No results found.</h3>';
                return;
            }
            appendMoviesToContainer(movies, searchResults);
        }
    }

    if (searchInput) {
        const debouncedSearch = debounce((e) => searchMovies(e.target.value), 500);
        searchInput.addEventListener('input', debouncedSearch);
    }

    // Boot Up Home Page
    if (document.getElementById('hero') && document.getElementById('search-input')) {
        loadHeroBanner();
        loadContinueWatching();
        loadMoreRows();
    }
});
