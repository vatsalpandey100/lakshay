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
// roomId -> { id, name, hostId, hostIds, isHostOnly, currentVideo, playback, queue, users, messages }
const rooms = new Map();

// Persistent Chat History Storage across refreshes and restarts
const CHAT_DATA_FILE = path.join(__dirname, 'data', 'chat_history.json');

function loadPersistedMessages(roomId) {
  try {
    if (fs.existsSync(CHAT_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHAT_DATA_FILE, 'utf8'));
      if (data && Array.isArray(data[roomId])) {
        return data[roomId];
      }
    }
  } catch (err) {
    console.error('Error loading chat history:', err.message);
  }
  return null;
}

function savePersistedMessages(roomId, messages) {
  try {
    const dataDir = path.dirname(CHAT_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    let allData = {};
    if (fs.existsSync(CHAT_DATA_FILE)) {
      try {
        allData = JSON.parse(fs.readFileSync(CHAT_DATA_FILE, 'utf8')) || {};
      } catch (e) {
        allData = {};
      }
    }
    // Store up to 250 messages per room
    allData[roomId] = (messages || []).slice(-250);
    fs.writeFileSync(CHAT_DATA_FILE, JSON.stringify(allData, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving chat history:', err.message);
  }
}

// Multi-Host Authority Helper: Vatsal is sovereign, plus any users appointed as co-hosts
function isUserHost(room, socketId, username = '') {
  if (!room) return false;
  const uname = (username || '').trim().toLowerCase();
  if (uname === 'vatsal') return true;
  if (room.coHostUsernames && uname && room.coHostUsernames.has(uname)) return true;
  if (room.hostId === socketId) return true;
  if (room.hostIds && room.hostIds.has(socketId)) return true;
  const user = room.users && room.users.get(socketId);
  if (user && user.isHost) return true;
  return false;
}

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
    const savedMessages = loadPersistedMessages(roomId);
    const initialVideo = PRESET_VIDEOS[0];
    rooms.set(roomId, {
      id: roomId,
      name: roomName || `Party ${roomId.substring(0, 6)}`,
      createdAt: Date.now(),
      hostId: null,
      hostIds: new Set(),
      coHostUsernames: new Set(),
      hostToken: null,
      hostName: 'Vatsal',
      isHostOnly: true, // Only hosted by Vatsal and chosen co-hosts
      currentVideo: { ...initialVideo },
      playback: {
        state: 'paused', // 'playing' | 'paused' | 'buffering'
        currentTime: 0,
        lastTimestamp: Date.now(),
        playbackRate: 1.0
      },
      queue: [],
      reactionCounts: {},
      users: new Map(), // socketId -> userData
      messages: savedMessages && savedMessages.length > 0 ? savedMessages : [
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

// High-Speed Parallel Chunked Video Upload Endpoint
app.post('/api/upload-chunk', express.raw({ type: 'application/octet-stream', limit: '35mb' }), async (req, res) => {
  try {
    const rawFilename = req.headers['x-file-name'] ? decodeURIComponent(req.headers['x-file-name']) : `anime-${Date.now()}.mp4`;
    const sanitized = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const chunkIndex = parseInt(req.headers['x-chunk-index'], 10) || 0;
    const totalChunks = parseInt(req.headers['x-total-chunks'], 10) || 1;

    const videoDir = path.join(__dirname, 'public', 'videos');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    // Temporary chunk staging directory for parallel uploads
    const chunkDir = path.join(videoDir, `.chunks-${sanitized}`);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const chunkPath = path.join(chunkDir, `part_${String(chunkIndex).padStart(5, '0')}`);
    await fs.promises.writeFile(chunkPath, req.body);

    // Check how many chunks have arrived
    const uploadedFiles = await fs.promises.readdir(chunkDir);
    const completedParts = uploadedFiles.filter(f => f.startsWith('part_'));

    if (completedParts.length >= totalChunks) {
      // Assemble all chunks strictly in numerical order
      const destPath = path.join(videoDir, sanitized);
      const writeStream = fs.createWriteStream(destPath);

      for (let i = 0; i < totalChunks; i++) {
        const pFile = path.join(chunkDir, `part_${String(i).padStart(5, '0')}`);
        if (fs.existsSync(pFile)) {
          const chunkData = await fs.promises.readFile(pFile);
          writeStream.write(chunkData);
          try { await fs.promises.unlink(pFile); } catch (e) {}
        }
      }
      writeStream.end();

      // Clean up chunk folder
      try {
        await fs.promises.rm(chunkDir, { recursive: true, force: true });
      } catch (e) {}

      return res.json({
        success: true,
        complete: true,
        url: `/videos/${sanitized}`,
        title: sanitized.replace(/^[0-9]+-/, '').replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ')
      });
    }

    res.json({
      success: true,
      complete: false,
      chunkIndex,
      totalChunks,
      receivedCount: completedParts.length
    });
  } catch (err) {
    console.error('Error in parallel chunk upload:', err);
    res.status(500).json({ error: 'Failed to process video chunk' });
  }
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

    // Sovereign Host Control: Vatsal or room creator or granted co-hosts
    const isVatsal = (username?.trim().toLowerCase() === 'vatsal');
    let isThisUserHost = false;
    if (isVatsal) {
      if (!room.hostToken) {
        room.hostToken = hostToken || `host-tok-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      }
      room.hostId = socket.id;
      room.hostName = 'Vatsal';
      if (!room.hostIds) room.hostIds = new Set();
      room.hostIds.add(socket.id);
      isThisUserHost = true;
    } else if (room.coHostUsernames && username && room.coHostUsernames.has(username.trim().toLowerCase())) {
      // Rejoining co-host
      if (!room.hostIds) room.hostIds = new Set();
      room.hostIds.add(socket.id);
      isThisUserHost = true;
    } else if (isCreating || !room.hostToken) {
      if (!room.hostToken) {
        room.hostToken = hostToken || `host-tok-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      }
      room.hostId = socket.id;
      room.hostName = username?.trim() || 'Host';
      if (!room.hostIds) room.hostIds = new Set();
      room.hostIds.add(socket.id);
      isThisUserHost = true;
    } else if (hostToken && (hostToken === room.hostToken || (room.hostTokens && room.hostTokens.has(hostToken)))) {
      // Rejoining host
      room.hostId = socket.id;
      if (!room.hostIds) room.hostIds = new Set();
      room.hostIds.add(socket.id);
      isThisUserHost = true;
    }

    const userData = {
      socketId: socket.id,
      username: username?.trim() || (isThisUserHost ? (isVatsal ? 'Vatsal' : 'Host') : `Viewer ${Math.floor(Math.random() * 900 + 100)}`),
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
        hostIds: Array.from(room.hostIds || []),
        isHostOnly: room.isHostOnly,
        currentVideo: room.currentVideo,
        playback: {
          ...room.playback,
          currentTime: accurateTime
        },
        queue: room.queue,
        reactionCounts: room.reactionCounts || {},
        users: Array.from(room.users.values()),
        messages: room.messages.slice(-100)
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
    savePersistedMessages(roomId, room.messages);

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
    if (room.isHostOnly && !isUserHost(room, socket.id, currentUser?.username)) {
      socket.emit('error-msg', { message: 'Only hosts have playback controls enabled.' });
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

    if (room.isHostOnly && !isUserHost(room, socket.id, currentUser?.username)) {
      socket.emit('error-msg', { message: 'Only hosts can change videos.' });
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

  // Instant Local File Match Prompt (allows friends to sync 0s instantly if they have the file)
  socket.on('local-file-started', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    socket.to(currentRoomId).emit('local-file-prompt', {
      hostName: currentUser ? currentUser.username : 'Host',
      filename: data.filename,
      size: data.size,
      title: data.title
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

    if (room.isHostOnly && !isUserHost(room, socket.id, currentUser?.username)) {
      socket.emit('error-msg', { message: 'Only hosts can skip or play from queue.' });
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
      savePersistedMessages(currentRoomId, room.messages);

      io.to(currentRoomId).emit('video-changed', {
        currentVideo: room.currentVideo,
        playback: room.playback,
        message: changeMsg
      });
      io.to(currentRoomId).emit('queue-updated', { queue: room.queue });
    }
  });

  // Chat message with video timestamp & @ mentions
  socket.on('send-message', ({ text, videoTime }) => {
    if (!currentRoomId || !rooms.has(currentRoomId) || !text?.trim()) return;
    const room = rooms.get(currentRoomId);

    const accurateVideoTime = typeof videoTime === 'number' && !isNaN(videoTime)
      ? Math.max(0, Math.floor(videoTime))
      : Math.floor(getAccuratePlaybackTime(room.playback));

    const sender = currentUser || room.users.get(socket.id) || {
      socketId: socket.id,
      username: 'Viewer',
      avatar: '🍿',
      isHost: isUserHost(room, socket.id)
    };

    const trimmedText = text.trim().substring(0, 500);
    // Parse @ mentions (e.g. @Vatsal, @everyone, @all)
    const rawMentions = trimmedText.match(/@([a-zA-Z0-9_\u00C0-\u017F]+)/g) || [];
    const mentions = rawMentions.map(m => m.substring(1));

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      user: sender,
      text: trimmedText,
      mentions,
      timestamp: Date.now(),
      videoTime: accurateVideoTime,
      system: false
    };

    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    savePersistedMessages(currentRoomId, room.messages);

    io.to(currentRoomId).emit('new-message', message);

    // Stop typing indicator on message send
    socket.to(currentRoomId).emit('user-typing', {
      socketId: socket.id,
      isTyping: false
    });
  });

  // WhatsApp-style "Who is writing" (Typing status)
  socket.on('typing-start', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = currentUser || room.users.get(socket.id);
    if (!user) return;
    socket.to(currentRoomId).emit('user-typing', {
      socketId: socket.id,
      username: user.username,
      avatar: user.avatar,
      isTyping: true
    });
  });

  socket.on('typing-stop', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    socket.to(currentRoomId).emit('user-typing', {
      socketId: socket.id,
      isTyping: false
    });
  });

  // Floating Reaction
  socket.on('send-reaction', ({ emoji }) => {
    if (!currentRoomId || !emoji) return;
    const room = rooms.get(currentRoomId);
    let count = 1;
    if (room) {
      if (!room.reactionCounts) room.reactionCounts = {};
      room.reactionCounts[emoji] = (room.reactionCounts[emoji] || 0) + 1;
      count = room.reactionCounts[emoji];
    }
    io.to(currentRoomId).emit('floating-reaction', {
      emoji,
      count,
      sender: currentUser ? currentUser.username : 'Someone',
      id: `react-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    });
  });

  // Toggle Host Only Lock
  socket.on('toggle-host-lock', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (!isUserHost(room, socket.id, currentUser?.username)) {
      socket.emit('error-msg', { message: 'Only hosts can toggle host controls.' });
      return;
    }

    room.isHostOnly = !room.isHostOnly;
    const lockMsg = {
      id: `sys-${Date.now()}`,
      system: true,
      text: room.isHostOnly
        ? `🔒 Host controls enabled. Only hosts can control playback.`
        : `🔓 Room control unlocked. Anyone can play, pause, or seek.`,
      timestamp: Date.now()
    };
    room.messages.push(lockMsg);
    savePersistedMessages(currentRoomId, room.messages);

    io.to(currentRoomId).emit('host-lock-changed', {
      isHostOnly: room.isHostOnly,
      message: lockMsg
    });
  });

  // Add / Remove Co-Host (Chosen by Vatsal or existing Host)
  socket.on('toggle-co-host', ({ targetSocketId, makeHost }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const caller = currentUser || room.users.get(socket.id);

    // Only existing hosts can grant or revoke host status
    if (!isUserHost(room, socket.id, caller?.username)) {
      socket.emit('error-msg', { message: 'Only hosts can manage host permissions.' });
      return;
    }

    if (room.users.has(targetSocketId)) {
      const targetUser = room.users.get(targetSocketId);
      const shouldBeHost = typeof makeHost === 'boolean' ? makeHost : !targetUser.isHost;

      // Don't allow revoking Vatsal's host status
      if (!shouldBeHost && (targetUser.username || '').trim().toLowerCase() === 'vatsal') {
        socket.emit('error-msg', { message: 'Vatsal is the primary host and cannot be removed.' });
        return;
      }

      targetUser.isHost = shouldBeHost;
      if (!room.hostIds) room.hostIds = new Set();
      if (!room.coHostUsernames) room.coHostUsernames = new Set();

      if (shouldBeHost) {
        room.hostIds.add(targetSocketId);
        if (targetUser.username) {
          room.coHostUsernames.add(targetUser.username.trim().toLowerCase());
        }
      } else {
        room.hostIds.delete(targetSocketId);
        if (targetUser.username) {
          room.coHostUsernames.delete(targetUser.username.trim().toLowerCase());
        }
        if (room.hostId === targetSocketId) {
          room.hostId = socket.id;
        }
      }

      const hostChangeMsg = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        system: true,
        text: shouldBeHost
          ? `👑 ${targetUser.username} was made a Host by ${caller?.username || 'Host'}.`
          : `👑 ${targetUser.username} is no longer a Host.`,
        timestamp: Date.now()
      };
      room.messages.push(hostChangeMsg);
      savePersistedMessages(currentRoomId, room.messages);

      io.to(currentRoomId).emit('hosts-updated', {
        users: Array.from(room.users.values()),
        message: hostChangeMsg
      });
    }
  });

  // Transfer Primary Host
  socket.on('transfer-host', ({ newHostSocketId }) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (!isUserHost(room, socket.id, currentUser?.username)) return;
    if (room.users.has(newHostSocketId)) {
      room.hostId = newHostSocketId;
      if (!room.hostIds) room.hostIds = new Set();
      room.hostIds.add(newHostSocketId);

      const targetUser = room.users.get(newHostSocketId);
      targetUser.isHost = true;

      const hostMsg = {
        id: `sys-${Date.now()}`,
        system: true,
        text: `👑 ${targetUser.username} is now a Host of this room.`,
        timestamp: Date.now()
      };
      room.messages.push(hostMsg);
      savePersistedMessages(currentRoomId, room.messages);

      io.to(currentRoomId).emit('hosts-updated', {
        hostId: room.hostId,
        users: Array.from(room.users.values()),
        message: hostMsg
      });
    }
  });

  // End session (for all if host, or individual leave)
  socket.on('end-session', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = room.users.get(socket.id);
    const isHost = isUserHost(room, socket.id, user?.username);

    if (isHost) {
      const endMsg = {
        id: `sys-${Date.now()}-ended`,
        system: true,
        text: `🚪 Watch party session ended by Host (${room.hostName || user?.username || 'Vatsal'}).`,
        timestamp: Date.now()
      };
      io.to(currentRoomId).emit('session-ended', {
        by: room.hostName || user?.username || 'Host',
        reason: 'Host ended the watch party session for everyone.',
        message: endMsg
      });

      rooms.delete(currentRoomId);
    } else {
      if (user) {
        room.users.delete(socket.id);
        const leaveMsg = {
          id: `sys-${Date.now()}`,
          system: true,
          text: `${user.avatar} ${user.username} left the room.`,
          timestamp: Date.now()
        };
        room.messages.push(leaveMsg);
        savePersistedMessages(currentRoomId, room.messages);

        io.to(currentRoomId).emit('user-left', {
          socketId: socket.id,
          users: Array.from(room.users.values()),
          message: leaveMsg
        });
      }
      socket.leave(currentRoomId);
      socket.emit('session-ended', {
        by: 'You',
        reason: 'You left the watch party.'
      });
    }
  });

  // Explicit leave room (keeps session active for others)
  socket.on('leave-room', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const user = room.users.get(socket.id);
    if (user) {
      room.users.delete(socket.id);
      const leaveMsg = {
        id: `sys-${Date.now()}`,
        system: true,
        text: `${user.avatar} ${user.username} left the room.`,
        timestamp: Date.now()
      };
      room.messages.push(leaveMsg);
      savePersistedMessages(currentRoomId, room.messages);

      io.to(currentRoomId).emit('user-left', {
        socketId: socket.id,
        users: Array.from(room.users.values()),
        message: leaveMsg
      });
    }
    socket.leave(currentRoomId);
    socket.emit('session-ended', {
      by: 'You',
      reason: 'You left the watch party.'
    });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      const user = room.users.get(socket.id);
      room.users.delete(socket.id);
      if (room.hostIds) room.hostIds.delete(socket.id);

      socket.to(currentRoomId).emit('user-typing', {
        socketId: socket.id,
        isTyping: false
      });

      if (user) {
        const leaveMsg = {
          id: `sys-${Date.now()}`,
          system: true,
          text: `${user.avatar} ${user.username} left the room.`,
          timestamp: Date.now()
        };
        room.messages.push(leaveMsg);
        savePersistedMessages(currentRoomId, room.messages);

        // Check if other hosts remain online
        const hasOtherHostOnline = Array.from(room.users.values()).some(u => u.isHost && u.socketId !== socket.id);
        if (room.hostId === socket.id) {
          if (hasOtherHostOnline) {
            const nextHost = Array.from(room.users.values()).find(u => u.isHost && u.socketId !== socket.id);
            room.hostId = nextHost ? nextHost.socketId : null;
          } else {
            room.hostId = null;
            const hostAwayMsg = {
              id: `sys-${Date.now()}-hostaway`,
              system: true,
              text: `👑 Host (${room.hostName || 'Vatsal'}) stepped away. Waiting for host to resume...`,
              timestamp: Date.now()
            };
            room.messages.push(hostAwayMsg);
            savePersistedMessages(currentRoomId, room.messages);
            io.to(currentRoomId).emit('host-away', { message: hostAwayMsg });
          }
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
