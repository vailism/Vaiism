# VAILISM — Premium Netflix-style Streaming UI

## Description

VAILISM is a high-performance, polished, Netflix-inspired streaming web application. It delivers a fast, responsive frontend built with core web technologies, featuring client-side persistence, offline resilience, and cross-tab synchronization. The project utilizes a serverless proxy backend to securely fetch dynamic metadata from The Movie Database (TMDB) without exposing sensitive API credentials.

## Core Features

- **Netflix-Style Visuals**: Harmonies of HSL-based dark mode colors, smooth scale-on-hover card transformations, custom skeleton loaders, and modern Outfit typography.
- **Robust Storage Architecture (IndexedDB)**: Replaced limited `localStorage` with a robust asynchronous IndexedDB wrapper (`vailism_db`). Automatically migrates legacy watchlists and progress records seamlessly on first launch.
- **Offline Resilience & Service Worker**: Serves a fast, pre-cached App Shell offline via `sw.js`, using a Stale-While-Revalidate caching pattern for HTML pages, stylesheets, images, and script assets.
- **Cross-Tab Synchronization**: Instant cross-tab UI refreshes using a `BroadcastChannel` system. Adding to your watchlist or updating playback progress in one window instantly reflects on all other open tabs.
- **BFCache Optimization**: Handles Back-Forward Cache (BFCache) browser navigation, ensuring UI state and progress indicators remain up-to-date when navigating back.
- **Multi-Server Streaming Selector**: Includes a dynamic modal player with fallbacks across 4 generic servers (`SERVER 1` to `SERVER 4`), featuring automated 8-second connection stall detection and auto-switching.
- **Unified Media Pages**: Dedicated detail portal ([details.html](file:///Volumes/Ssd%20for%20wor/All%20codes/NETFLIX%28vailism%29/details.html)) showing high-resolution backdrops, cast directories (optimized to prevent layout shifts), and reviews.

## Tech Stack

- **Frontend**: HTML5, Vanilla CSS3 (Variables, Flexbox/CSS Grid, Transforms), Vanilla ES6+ JavaScript.
- **Offline & Performance**: Service Workers, BroadcastChannel API, IndexedDB.
- **Backend / API**: TMDB API, Node.js + Express (Local proxy server), Vercel serverless functions (Production proxy).

## Project Structure

```text
📦 vailism
├── 📁 api/
│   └── tmdb.js          # Vercel serverless proxy function (production)
├── 📁 favicon/          # Logo variations, icons, and site webmanifest
├── index.html           # Main dashboard and rows portal
├── details.html         # Media descriptions, reviews, and cast layout
├── player.html          # Embedded fallback player container
├── style.css            # Theme styles, micro-animations, and responsiveness
├── script.js            # Main page event handlers, carousel feed, and IndexedDB controller
├── details.js           # Cast, review, and watchlist details handler
├── sw.js                # Service worker offline asset cache worker
├── server.js            # Local development Express server proxy
├── package.json         # Project package scripts and dependencies
├── vercel.json          # Deployment routes mapping for Vercel Serverless
├── .env                 # Environment secrets registry (ignored by Git)
└── .gitignore           # Git ignore list
```

## Setup Instructions

To run VAILISM locally, ensure you have **Node.js** installed.

1. **Clone the Repository**
   ```bash
   git clone https://github.com/vailism/Vaiism.git
   cd Vaiism
   ```

2. **Configure Secrets**
   Create a `.env` file in the root directory and add your TMDB API Key:
   ```env
   TMDB_API_KEY=your_private_api_key_here
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Launch Local Server**
   Run the local development proxy server:
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:3000`.

## Deployment

VAILISM is configured to deploy directly to **Vercel**:

1. Push your changes to your Git repository (GitHub/GitLab/Bitbucket).
2. Connect your repository to Vercel.
3. In the Vercel project settings, add the `TMDB_API_KEY` under **Environment Variables**.
4. Deploy the project. Vercel automatically deploys the `/api/tmdb` route as a serverless edge function.

## Security Architecture

VAILISM strictly separates the client-side UI from API key storage. All requests to TMDB flow through the local `server.js` proxy or Vercel edge functions. This prevents exposing your private `TMDB_API_KEY` in browser fetch requests or network inspect panels.