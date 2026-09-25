const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Zero-lag options
  transports: ['websocket', 'polling'],
  perMessageDeflate: false,
  pingInterval: 10000,
  pingTimeout: 5000
});

const PORT = process.env.PORT || 3000;

// Room storage (in-memory for active sessions)
// roomId -> { id, name, hostId, isHostOnly, currentVideo, playback, queue, users, messages }
const rooms = new Map();

// Preset videos for quick demo and fallback
const PRESET_VIDEOS = [
  {
    id: 'preset-1',
    title: 'Big Buck Bunny (Animation 4K)',
    type: 'html5',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    duration: 596
  },
  {
    id: 'preset-2',
    title: 'Tears of Steel (Sci-Fi CGI Short)',
    type: 'html5',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80',
    duration: 734
  },
  {
    id: 'preset-3',
    title: 'Sintel (Open Movie Project)',
    type: 'html5',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    duration: 888
  },
  {
    id: 'preset-4',
    title: 'Lofi Hip Hop - Chill Beats Relax',
    type: 'youtube',
    url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    duration: 0
  }
];

function getOrCreateRoom(roomId, roomName = null) {
  if (!rooms.has(roomId)) {
    const initialVideo = PRESET_VIDEOS[0];
    rooms.set(roomId, {
      id: roomId,
      name: roomName || `Party ${roomId.substring(0, 6)}`,
      createdAt: Date.now(),
      hostId: null,
      hostToken: null,
      hostName: 'Lakshay',
      isHostOnly: true, // Only hosted by Lakshay
      currentVideo: { ...initialVideo },
      playback: {
        state: 'paused', // 'playing' | 'paused' | 'buffering'
        currentTime: 0,
        lastTimestamp: Date.now(),
        playbackRate: 1.0
      },
      queue: [
        { ...PRESET_VIDEOS[1], addedBy: 'System' },
        { ...PRESET_VIDEOS[2], addedBy: 'System' }
      ],
      users: new Map(), // socketId -> userData
      messages: [
        {
          id: 'welcome',
          system: true,
          text: `Welcome to the room! Paste any YouTube or direct MP4 link, or pick from presets to watch together in sync.`,
          timestamp: Date.now()
        }
      ]
    });
  }
  return rooms.get(roomId);
}

// Compute calculated current playback time based on elapsed time if playing
function getAccuratePlaybackTime(playback) {
  if (playback.state === 'playing') {
    const elapsedSeconds = (Date.now() - playback.lastTimestamp) / 1000;
    return playback.currentTime + elapsedSeconds * (playback.playbackRate || 1.0);
  }
  return playback.currentTime;
}

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: Get public rooms
app.get('/api/rooms', (req, res) => {
  const publicRooms = [];
  for (const [id, room] of rooms.entries()) {
    if (room.users.size > 0) {
      publicRooms.push({
        id: room.id,
        name: room.name,
        userCount: room.users.size,
        currentVideo: room.currentVideo,
        playbackState: room.playback.state
      });
    }
  }
  res.json({ rooms: publicRooms });
});

// API: Get preset library
app.get('/api/presets', (req, res) => {
  res.json({ presets: PRESET_VIDEOS });
});

// High-performance HTTP 206 Partial Content Video Streaming Route
app.get('/videos/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const videoPath = path.join(__dirname, 'public', 'videos', filename);

  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/mp4', // Common h264 stream
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.ogv': 'video/ogg'
  };
  const contentType = mimeMap[ext] || 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Chunked Video Upload Endpoint: Bypasses Cloudflare 100MB single-request limit
app.post('/api/upload-chunk', express.raw({ type: 'application/octet-stream', limit: '30mb' }), (req, res) => {
  const rawFilename = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : `anime-${Date.now()}.mp4`;
  const sanitized = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10) || 0;
  const totalChunks = parseInt(req.headers['x-total-chunks'], 10) || 1;

  const videoDir = path.join(__dirname, 'public', 'videos');
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const destPath = path.join(videoDir, sanitized);

  // If first chunk, clean existing file
  if (chunkIndex === 0 && fs.existsSync(destPath)) {
    try { fs.unlinkSync(destPath); } catch (e) {}
  }

  // Append binary buffer to the file
  fs.appendFile(destPath, req.body, (err) => {
    if (err) {
      console.error('Error writing video chunk:', err);
      return res.status(500).json({ error: 'Failed to write chunk' });
    }

    const isComplete = chunkIndex >= totalChunks - 1;
    if (isComplete) {
      return res.json({
        success: true,
        complete: true,
        url: `/videos/${sanitized}`,
        title: sanitized.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ')
      });
    }

    res.json({
      success: true,
      complete: false,
      chunkIndex,
      totalChunks
    });
  });
});

// Stream Upload Endpoint: Host uploads anime video directly to stream to all friends
app.post('/api/upload-video', (req, res) => {
  const rawFilename = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : `anime-${Date.now()}.mp4`;
  const sanitized = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const videoDir = path.join(__dirname, 'public', 'videos');

  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  const destPath = path.join(videoDir, sanitized);
  const writeStream = fs.createWriteStream(destPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    res.json({
      success: true,
      url: `/videos/${sanitized}`,
      title: sanitized.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ')
    });
  });

  writeStream.on('error', (err) => {
    console.error('Video upload error:', err);
    res.status(500).json({ error: 'Failed to process video stream' });
  });
});

// Route: Room page
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Socket.io Real-time sync engine
io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUser = null;

  socket.on('join-room', ({ roomId, username, avatar, roomName, hostToken, isCreating }) => {
    currentRoomId = roomId;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId, roomName);

    // Sovereign Host Control: Only the creator (Lakshay) holds host authority
    let isThisUserHost = false;
    if (isCreating || !room.hostToken) {
      room.hostToken = hostToken || `host-tok-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      room.hostId = socket.id;
      room.hostName = username?.trim() || 'Lakshay';
      isThisUserHost = true;
    } else if (hostToken && hostToken === room.hostToken) {
      // Rejoining host
      room.hostId = socket.id;
      room.hostName = username?.trim() || room.hostName;
      isThisUserHost = true;
    }

    const userData = {
      socketId: socket.id,
      username: username?.trim() || (isThisUserHost ? 'Lakshay' : `Viewer ${Math.floor(Math.random() * 900 + 100)}`),
      avatar: avatar || (isThisUserHost ? '👑' : '🍿'),
      isHost: isThisUserHost,
      joinedAt: Date.now()
    };
    currentUser = userData;
    room.users.set(socket.id, userData);

    // Compute active time
    const accurateTime = getAccuratePlaybackTime(room.playback);

    // Send full current room state to joining user
    socket.emit('room-state', {
      room: {
        id: room.id,
        name: room.name,
        hostId: room.hostId,
        isHostOnly: room.isHostOnly,
        currentVideo: room.currentVideo,
        playback: {
          ...room.playback,
          currentTime: accurateTime
        },
        queue: room.queue,
        users: Array.from(room.users.values()),
        messages: room.messages.slice(-40)
      },
      you: {
        ...userData,
        hostToken: isThisUserHost ? room.hostToken : null
      }
    });

    // Notify room of new user
    const joinMsg = {
      id: `sys-${Date.now()}-${Math.random()}`,
      system: true,
      text: `${userData.avatar} ${userData.username} joined the party.`,
      timestamp: Date.now()
    };
    room.messages.push(joinMsg);

    io.to(roomId).emit('user-joined', {
      user: userData,
      users: Array.from(room.users.values()),
      message: joinMsg
    });
  });

  // Playback Control Event (Play / Pause / Seek / Rate)
  socket.on('playback-action', ({ action, currentTime, playbackRate }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    // Check host-only lock
    if (room.isHostOnly && room.hostId !== socket.id) {
      socket.emit('error-msg', { message: 'Only the host has playback controls enabled.' });
      return;
    }

    const now = Date.now();
    const parsedTime = typeof currentTime === 'number' && !isNaN(currentTime) ? Math.max(0, currentTime) : room.playback.currentTime;

    if (action === 'play') {
      room.playback.state = 'playing';
      room.playback.currentTime = parsedTime;
      room.playback.lastTimestamp = now;
      if (playbackRate) room.playback.playbackRate = playbackRate;
    } else if (action === 'pause') {
      room.playback.state = 'paused';
      room.playback.currentTime = parsedTime;
      room.playback.lastTimestamp = now;
    } else if (action === 'seek') {
      room.playback.currentTime = parsedTime;
      room.playback.lastTimestamp = now;
    } else if (action === 'rate') {
      room.playback.playbackRate = playbackRate || 1.0;
      room.playback.currentTime = parsedTime;
      room.playback.lastTimestamp = now;
    }

    // Broadcast state to all other peers in room (sender already executed optimistically!)
    socket.broadcast.to(currentRoomId).emit('sync-playback', {
      action,
      state: room.playback.state,
      currentTime: room.playback.currentTime,
      serverTime: now,
      playbackRate: room.playback.playbackRate,
      senderId: socket.id,
      senderName: currentUser ? currentUser.username : 'Someone'
    });
  });

  // High-precision NTP clock synchronization
  socket.on('ntp-ping', (clientSendTime) => {
    socket.emit('ntp-pong', {
      clientSendTime,
      serverTime: Date.now()
    });
  });

  // Video upload progress broadcast from host to room
  socket.on('upload-progress', ({ filename, progress }) => {
    if (!currentRoomId) return;
    socket.broadcast.to(currentRoomId).emit('peer-upload-progress', {
      sender: currentUser ? currentUser.username : 'Lakshay',
      filename,
      progress
    });
  });

  // Video Source Change
  socket.on('change-video', (videoData) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (room.isHostOnly && room.hostId !== socket.id) {
      socket.emit('error-msg', { message: 'Only the host can change videos.' });
      return;
    }

    const startTime = typeof videoData.currentTime === 'number' && !isNaN(videoData.currentTime)
      ? Math.max(0, videoData.currentTime)
      : 0;

    room.currentVideo = {
      id: `vid-${Date.now()}`,
      title: videoData.title || 'Custom Video',
      type: videoData.type || 'html5',
      url: videoData.url || '',
      isLocal: !!videoData.isLocal,
      filename: videoData.filename || '',
      thumbnail: videoData.thumbnail || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80',
      duration: videoData.duration || 0
    };

    room.playback = {
      state: 'playing',
      currentTime: startTime,
      lastTimestamp: Date.now(),
      playbackRate: 1.0
    };

    const changeMsg = {
      id: `sys-${Date.now()}-${Math.random()}`,
      system: true,
      text: `🎬 ${currentUser ? currentUser.username : 'Someone'} started playing: "${room.currentVideo.title}"`,
      timestamp: Date.now()
    };
    room.messages.push(changeMsg);

    io.to(currentRoomId).emit('video-changed', {
      currentVideo: room.currentVideo,
      playback: room.playback,
      message: changeMsg
    });
  });

  // Time Sync Drift Query (client checks in periodically or when requested)
  socket.on('query-sync', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    socket.emit('sync-response', {
      state: room.playback.state,
      currentTime: getAccuratePlaybackTime(room.playback),
      serverTime: Date.now(),
      playbackRate: room.playback.playbackRate
    });
  });

  // Queue Operations
  socket.on('queue-add', (videoData) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    const item = {
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      title: videoData.title || 'Queued Video',
      type: videoData.type || 'html5',
      url: videoData.url,
      thumbnail: videoData.thumbnail || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80',
      duration: videoData.duration || 0,
      addedBy: currentUser ? currentUser.username : 'Guest'
    };

    room.queue.push(item);

    const qMsg = {
      id: `sys-${Date.now()}`,
      system: true,
      text: `📋 ${item.addedBy} added "${item.title}" to the queue.`,
      timestamp: Date.now()
    };
    room.messages.push(qMsg);

    io.to(currentRoomId).emit('queue-updated', {
      queue: room.queue,
      message: qMsg
    });
  });

  socket.on('queue-remove', ({ index }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    if (index >= 0 && index < room.queue.length) {
      room.queue.splice(index, 1);
      io.to(currentRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  socket.on('queue-play-item', ({ index }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (room.isHostOnly && room.hostId !== socket.id) {
      socket.emit('error-msg', { message: 'Only the host can skip or play from queue.' });
      return;
    }

    if (index >= 0 && index < room.queue.length) {
      const nextVid = room.queue.splice(index, 1)[0];
      room.currentVideo = nextVid;
      room.playback = {
        state: 'playing',
        currentTime: 0,
        lastTimestamp: Date.now(),
        playbackRate: 1.0
      };

      const changeMsg = {
        id: `sys-${Date.now()}`,
        system: true,
        text: `⏭ Now playing from queue: "${nextVid.title}"`,
        timestamp: Date.now()
      };
      room.messages.push(changeMsg);

      io.to(currentRoomId).emit('video-changed', {
        currentVideo: room.currentVideo,
        playback: room.playback,
        message: changeMsg
      });
      io.to(currentRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  // Chat message with video timestamp
  socket.on('send-message', ({ text, videoTime }) => {
    if (!currentRoomId || !rooms.has(currentRoomId) || !text?.trim()) return;
    const room = rooms.get(currentRoomId);

    const accurateVideoTime = typeof videoTime === 'number' && !isNaN(videoTime)
      ? Math.max(0, Math.floor(videoTime))
      : Math.floor(getAccuratePlaybackTime(room.playback));

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      user: currentUser,
      text: text.trim().substring(0, 500),
      timestamp: Date.now(),
      videoTime: accurateVideoTime,
      system: false
    };

    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();

    io.to(currentRoomId).emit('new-message', message);
  });

  // Floating Reaction
  socket.on('send-reaction', ({ emoji }) => {
    if (!currentRoomId || !emoji) return;
    io.to(currentRoomId).emit('floating-reaction', {
      emoji,
      sender: currentUser ? currentUser.username : 'Someone',
      id: `react-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    });
  });

  // Toggle Host Only Lock
  socket.on('toggle-host-lock', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (room.hostId !== socket.id) {
      socket.emit('error-msg', { message: 'Only current host can toggle host controls.' });
      return;
    }

    room.isHostOnly = !room.isHostOnly;
    const lockMsg = {
      id: `sys-${Date.now()}`,
      system: true,
      text: room.isHostOnly
        ? `🔒 Host controls enabled. Only the host can control playback.`
        : `🔓 Room control unlocked. Anyone can play, pause, or seek.`,
      timestamp: Date.now()
    };
    room.messages.push(lockMsg);

    io.to(currentRoomId).emit('host-lock-changed', {
      isHostOnly: room.isHostOnly,
      message: lockMsg
    });
  });

  // Transfer Host
  socket.on('transfer-host', ({ newHostSocketId }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (room.hostId !== socket.id) return;
    if (room.users.has(newHostSocketId)) {
      room.hostId = newHostSocketId;

      // Update users
      for (const [sid, u] of room.users.entries()) {
        u.isHost = sid === newHostSocketId;
      }

      const newHost = room.users.get(newHostSocketId);
      const hostMsg = {
        id: `sys-${Date.now()}`,
        system: true,
        text: `👑 ${newHost.username} is now the host of this room.`,
        timestamp: Date.now()
      };
      room.messages.push(hostMsg);

      io.to(currentRoomId).emit('host-transferred', {
        hostId: room.hostId,
        users: Array.from(room.users.values()),
        message: hostMsg
      });
    }
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      const user = room.users.get(socket.id);
      room.users.delete(socket.id);

      if (user) {
        const leaveMsg = {
          id: `sys-${Date.now()}`,
          system: true,
          text: `${user.avatar} ${user.username} left the room.`,
          timestamp: Date.now()
        };
        room.messages.push(leaveMsg);

        // If host temporarily leaves, do NOT pass host to guest
        if (room.hostId === socket.id) {
          room.hostId = null;
          const hostAwayMsg = {
            id: `sys-${Date.now()}-hostaway`,
            system: true,
            text: `👑 Host (${room.hostName || 'Lakshay'}) stepped away. Waiting for host to resume...`,
            timestamp: Date.now()
          };
          room.messages.push(hostAwayMsg);
          io.to(currentRoomId).emit('host-away', { message: hostAwayMsg });
        }

        io.to(currentRoomId).emit('user-left', {
          socketId: socket.id,
          users: Array.from(room.users.values()),
          message: leaveMsg
        });
      }

      // Cleanup empty rooms after 1 hour if empty
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(currentRoomId) && rooms.get(currentRoomId).users.size === 0) {
            rooms.delete(currentRoomId);
          }
        }, 3600000);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎬 SyncPulse Cinema server running at http://localhost:${PORT}`);
});
