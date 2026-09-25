# ⚡ Lakshay — Watch Anime & Videos Together

**Lakshay** is an ultra-low latency, real-time synchronized cinema platform designed specifically for watching anime, movies, and YouTube videos with friends anywhere in the world in millisecond sync.

---

## ⚡ Zero-Lag Engine Highlights

1. **Sub-20ms NTP Clock Synchronization**: Uses Cristian's Algorithm to synchronize client-server clocks, eliminating local time skew between devices.
2. **Smooth Rate-Steering Sync (Zero Buffer Flushes)**: Instead of jarring hard seeks that cause video buffering spins and audio pops, small drifts (0.1s - 1.2s) are dynamically micro-steered by adjusting the playback rate (±5%) until seamlessly aligned.
3. **Optimized Socket.IO**: Direct volatile-friendly transport with WebSocket prioritization and zero CPU compression overhead (`perMessageDeflate: false`).
4. **Optimized Ambient Glow**: Ambient theater canvas lighting is throttled to 18fps, saving 80% CPU/GPU overhead for native 60fps video decoding.

---

## 🌸 Anime Watching Options

### 1. 📂 Local Anime File Sync (Recommended for 4K / High Bitrate)
- Click **"📂 Open Anime File"** or simply drag & drop your `.mp4`, `.mkv`, or `.webm` anime file directly onto the video player.
- **Why this is unbeatable:** Zero upload waiting time, zero buffering, crystal native resolution, and 100% real-time synchronized playback (play/pause/seek/chat/reactions)!
- When you pick an anime file, your friend gets an instant prompt: *"Room is watching: [filename.mp4]. Click here to select your copy to sync!"*

### 2. 📁 Project Folder Streaming
- Drop any anime video file directly into the `public/videos/` folder (e.g. `public/videos/my_anime.mp4`).
- Load `/videos/my_anime.mp4` into the URL box and stream it directly to both of you!

### 3. 🌐 Online Streaming & YouTube
- Paste any direct anime MP4/WebM URL or any YouTube link to stream together in 1 click.

---

## ☁️ Cloudflare Deployment / Live Friend Sharing

You can share **Lakshay** with your friends anywhere across the globe using Cloudflare's free, zero-config tunnel!

### Step 1: Start Lakshay
In terminal:
```bash
npm start
```
*(Runs on `http://localhost:3000`)*

### Step 2: Generate Cloudflare Live URL
In a second terminal window:
```bash
npm run tunnel
```
or:
```bash
npx cloudflared tunnel --url http://localhost:3000
```

Cloudflare will instantly output a public, secure HTTPS link like:
```text
https://random-words-here.trycloudflare.com
```

### Step 3: Send the Link to Your Friend
Send that link to your friend! Both of you will enter the **Lakshay** cinema room with full real-time sync, live chat, and reactions across the world with zero lag!

---

## 🚀 Quick Local Start

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open in browser
# Visit http://localhost:3000
```

---

## ⌨️ Hotkeys

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / Pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Rewind / Fast Forward 5s |
| <kbd>M</kbd> | Mute / Unmute |
| <kbd>F</kbd> | Fullscreen |
