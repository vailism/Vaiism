/**
 * @file server.js
 * @description Lightweight real-time synchronization backend for Vailism Watch Together.
 * Uses Express for health endpoints and Socket.io for real-time playhead sync and messaging.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');

const app = express();

// Trust reverse proxy for client IP rate limiting behind Render Load Balancers
app.set('trust proxy', 1);

// Add security headers (disables X-Powered-By, configures HSTS, etc.)
app.use(helmet());

// Compress JSON responses
app.use(compression());

// Set payload size limits
app.use(express.json({ limit: '10kb' }));

// Production CORS Origin validation
const clientOrigin = process.env.CLIENT_ORIGIN || 'https://vaibhavanand.codes';
app.use(cors({
    origin: clientOrigin,
    methods: ['GET', 'POST']
}));

// Apply request rate limit to health endpoint
const healthLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes window
    max: 100, // Limit each IP to 100 requests per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Please try again later.' }
});

// Health endpoint for keep-warm pings and monitoring
app.get('/health', healthLimiter, (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: Date.now()
    });
});

const server = http.createServer(app);

// Production Socket.io config
// - websocket-only transport to bypass slow HTTP polling connections
// - pingTimeout / pingInterval custom values for slow networks
const io = new Server(server, {
    cors: {
        origin: clientOrigin,
        methods: ['GET', 'POST']
    },
    transports: ['websocket'],
    pingTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT_MS) || 20000,
    pingInterval: 10000
});

/**
 * IN-MEMORY STATE SCHEMA:
 * rooms: Map (roomId -> RoomObject)
 * 
 * RoomObject Schema:
 * {
 *   id: string,                 // Room identifier token
 *   hostId: string,             // Socket ID of the room controller
 *   videoId: string,            // TMDB content identifier
 *   videoType: string,          // 'movie' or 'tv'
 *   participants: Array<{       // List of active members in the room
 *     socketId: string,
 *     name: string
 *   }>,
 *   lastSync: {                 // Latest playhead snapshot
 *     currentTime: number,
 *     playing: boolean,
 *     ts: number
 *   },
 *   createdAt: number
 * }
 */
const rooms = new Map();

// Rate limiting map for anti-spam (socket.id -> Array of event timestamps)
const chatRateLimits = new Map();

// Helper to generate random 6-character room codes (alphanumeric uppercase)
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Handle collison checks (ensure unique keys)
    return rooms.has(code) ? generateRoomCode() : code;
}

io.on('connection', (socket) => {
    console.log(`[Socket.io] New client connected: ${socket.id}`);

    // ── 1. Create Room Event ────────────────────────────────────────────────
    socket.on('create-room', (payload, callback) => {
        if (!payload || !payload.videoId || !payload.videoType || !payload.hostName) {
            return callback?.({ error: 'Malformed create-room payload' });
        }

        const roomId = generateRoomCode();
        const hostName = String(payload.hostName).trim().substring(0, 20); // Limit name size to prevent visual bugs

        const newRoom = {
            id: roomId,
            hostId: socket.id,
            videoId: payload.videoId,
            videoType: payload.videoType,
            participants: [{ socketId: socket.id, name: hostName }],
            lastSync: { currentTime: 0, playing: false, ts: Date.now() },
            createdAt: Date.now()
        };

        rooms.set(roomId, newRoom);
        socket.join(roomId);

        console.log(`[Room] Created: ${roomId} by Host: ${hostName} (${socket.id})`);
        
        if (typeof callback === 'function') {
            callback({
                success: true,
                roomId,
                hostId: socket.id,
                participants: newRoom.participants
            });
        }
    });

    // ── 2. Join Room Event ──────────────────────────────────────────────────
    socket.on('join-room', (payload, callback) => {
        if (!payload || !payload.roomId || !payload.userName) {
            return callback?.({ error: 'Malformed join-room payload' });
        }

        const roomId = String(payload.roomId).toUpperCase().trim();
        const userName = String(payload.userName).trim().substring(0, 20);

        const room = rooms.get(roomId);
        if (!room) {
            return callback?.({ error: 'Room not found or session has expired.' });
        }

        // Room size check (limits maximum participants to 15 to safeguard free tier memory)
        if (room.participants.length >= 15) {
            return callback?.({ error: 'Room is full (max 15 viewers)' });
        }

        // Duplicate socket prevention
        const isAlreadyJoined = room.participants.some(p => p.socketId === socket.id);
        if (isAlreadyJoined) {
            return callback?.({ error: 'You are already in this room' });
        }

        // Add guest details
        room.participants.push({ socketId: socket.id, name: userName });
        socket.join(roomId);

        console.log(`[Room] Participant: ${userName} (${socket.id}) joined room: ${roomId}`);

        // Notify socket
        if (typeof callback === 'function') {
            callback({
                success: true,
                hostId: room.hostId,
                videoId: room.videoId,
                videoType: room.videoType,
                participants: room.participants,
                lastSync: room.lastSync
            });
        }

        // Broadcast to other room members
        socket.to(roomId).emit('user-joined', {
            socketId: socket.id,
            name: userName,
            participants: room.participants
        });
    });

    // ── 3. Sync Event (Playhead alignment updates) ──────────────────────────
    socket.on('sync-event', (payload) => {
        if (!payload || typeof payload.currentTime !== 'number' || typeof payload.playing !== 'boolean') {
            return;
        }

        // Find room by tracing rooms Map values
        let activeRoom = null;
        let roomId = null;
        for (const [id, rm] of rooms.entries()) {
            if (rm.participants.some(p => p.socketId === socket.id)) {
                activeRoom = rm;
                roomId = id;
                break;
            }
        }

        if (!activeRoom) return;

        // Authority Validation: Only the designated Host can broadcast playhead updates
        if (activeRoom.hostId !== socket.id) {
            console.warn(`[Sync] Rejected non-host sync command from socket: ${socket.id}`);
            return;
        }

        // Update active playhead snapshot
        activeRoom.lastSync = {
            currentTime: payload.currentTime,
            playing: payload.playing,
            buffering: payload.buffering || false,
            playbackRate: payload.playbackRate || 1.0,
            ts: payload.ts || Date.now()
        };

        // Broadcast current alignment parameters to other guests in the namespace
        socket.to(roomId).emit('sync-state', {
            action: payload.playing ? 'PLAY' : 'PAUSE',
            currentTime: payload.currentTime,
            playing: payload.playing,
            buffering: payload.buffering || false,
            playbackRate: payload.playbackRate || 1.0,
            ts: payload.ts || Date.now()
        });
    });

    // ── 4. Chat Message Event ────────────────────────────────────────────────
    socket.on('chat-message', (payload) => {
        if (!payload || !payload.text) return;
        const text = String(payload.text).trim().substring(0, 150); // Limit message size to prevent overflow
        if (!text) return;

        // Anti-Spam protection: limit each client to 2 messages per second
        const now = Date.now();
        let timestamps = chatRateLimits.get(socket.id) || [];
        // Filter out timestamps older than 1 second
        timestamps = timestamps.filter(ts => now - ts < 1000);
        
        if (timestamps.length >= 2) {
            socket.emit('error-msg', { message: 'Chat rate limit exceeded. Slow down!' });
            return;
        }

        timestamps.push(now);
        chatRateLimits.set(socket.id, timestamps);

        // Find current room
        let roomId = null;
        let userName = 'Guest';
        for (const [id, rm] of rooms.entries()) {
            const p = rm.participants.find(part => part.socketId === socket.id);
            if (p) {
                roomId = id;
                userName = p.name;
                break;
            }
        }

        if (!roomId) return;

        // Broadcast message to room
        io.to(roomId).emit('chat-message', {
            senderId: socket.id,
            senderName: userName,
            text,
            ts: Date.now()
        });
    });

    // ── 5. Typing Event ─────────────────────────────────────────────────────
    socket.on('typing', (payload) => {
        if (!payload || typeof payload.isTyping !== 'boolean') return;

        let roomId = null;
        let userName = '';
        for (const [id, rm] of rooms.entries()) {
            const p = rm.participants.find(part => part.socketId === socket.id);
            if (p) {
                roomId = id;
                userName = p.name;
                break;
            }
        }

        if (!roomId) return;

        socket.to(roomId).emit('typing', {
            senderId: socket.id,
            senderName: userName,
            isTyping: payload.isTyping
        });
    });

    // ── 6. Heartbeat Event ──────────────────────────────────────────────────
    socket.on('heartbeat', () => {
        socket.emit('heartbeat-ack');
    });

    // ── 7. Leave / Disconnect Event ─────────────────────────────────────────
    socket.on('leave-room', () => {
        handleUserExit(socket);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
        handleUserExit(socket);
        chatRateLimits.delete(socket.id); // Clean up rate limit states
    });
});

/**
 * Handles removing socket from active rooms, performing host reassignments and cleanup.
 */
function handleUserExit(socket) {
    for (const [roomId, room] of rooms.entries()) {
        const index = room.participants.findIndex(p => p.socketId === socket.id);
        
        if (index !== -1) {
            const removedUser = room.participants[index];
            room.participants.splice(index, 1); // Remove member
            
            console.log(`[Room] Exit: ${removedUser.name} left room: ${roomId}`);
            socket.leave(roomId);

            // Empty room cleanup
            if (room.participants.length === 0) {
                rooms.delete(roomId);
                console.log(`[Room] Pruned empty room: ${roomId}`);
                continue;
            }

            // Host Reassignment: If host disconnected, assign leadership to oldest guest
            if (room.hostId === socket.id) {
                const newHost = room.participants[0];
                room.hostId = newHost.socketId;
                
                console.log(`[Room] Host Migrated to: ${newHost.name} (${newHost.socketId}) in room: ${roomId}`);
                io.to(roomId).emit('host-changed', {
                    hostId: room.hostId,
                    hostName: newHost.name,
                    participants: room.participants
                });
            }

            // Notify remaining guests
            io.to(roomId).emit('user-left', {
                socketId: socket.id,
                name: removedUser.name,
                participants: room.participants
            });
        }
    }
}

// ── Housekeeping: Inactive Room Cleanup ──────────────────────────────────────
// Runs every 5 minutes to clear out stale rooms (created > 12 hours ago)
// to prevent memory accumulation in-memory on the free-tier service.
setInterval(() => {
    const now = Date.now();
    let pruneCount = 0;
    for (const [roomId, room] of rooms.entries()) {
        const isStale = now - room.createdAt > 12 * 60 * 60 * 1000; // 12 hours limit
        if (isStale || room.participants.length === 0) {
            rooms.delete(roomId);
            pruneCount++;
        }
    }
    if (pruneCount > 0) {
        console.log(`[Housekeeping] Pruned ${pruneCount} stale room(s). Active rooms remaining: ${rooms.size}`);
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Vailism Backend] Sync Server listening on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Graceful shutdown handler
function gracefulShutdown(signal) {
    console.log(`[Vailism Backend] Received ${signal}. Shutting down gracefully...`);
    
    // Close HTTP server and Socket.io
    io.close(() => {
        console.log('[Vailism Backend] Socket.io closed.');
        server.close(() => {
            console.log('[Vailism Backend] Server closed.');
            process.exit(0);
        });
    });

    // Force shutdown after 10s to avoid hanging during container stops
    setTimeout(() => {
        console.error('[Vailism Backend] Force shutdown initiated after timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
