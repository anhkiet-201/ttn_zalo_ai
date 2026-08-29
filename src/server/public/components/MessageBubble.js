import React, { useState, useRef, useEffect } from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp));
  if (isNaN(date.getTime())) return '';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatVoiceTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// Biến toàn cục lưu audio đang phát để tự động dừng khi phát audio khác
let currentlyPlayingAudio = null;

// Độ cao mô phỏng cột sóng âm thanh chính xác theo giao diện Zalo
const WAVEFORM_HEIGHTS = [
  6, 8, 10, 14, 20, 22, 18, 14, 10, 8, 6, 6, 8, 12, 18, 22, 24, 20, 16, 12, 8, 6, 6, 6, 6, 6, 6, 6
];

/**
 * ZaloImageItem: Hiển thị ảnh Zalo CDN với delay 500ms trước khi load lần đầu.
 * Giảm thiểu retry do CDN propagation delay cho ảnh vừa upload.
 * Nếu vẫn lỗi: retry tối đa 5 lần với delay tăng dần 1s, 2s, 3s, 4s, 5s.
 */
function ZaloImageItem({ src, className, alt, onClick }) {
  const [activeSrc, setActiveSrc] = useState(null); // null = đang chờ delay ban đầu
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);
  const timerRef = useRef(null);
  const MAX_RETRIES = 5;

  useEffect(() => {
    // Reset state khi src thay đổi
    setActiveSrc(null);
    setRetryCount(0);
    setHasError(false);

    // Delay 500ms trước khi bắt đầu load để CDN có thời gian sẵn sàng
    timerRef.current = setTimeout(() => setActiveSrc(src), 500);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  const handleError = () => {
    if (retryCount >= MAX_RETRIES) {
      setHasError(true);
      return;
    }
    const nextRetry = retryCount + 1;
    const delay = nextRetry * 1000; // 1s, 2s, 3s, 4s, 5s
    setActiveSrc(null); // Trở về trạng thái loading trong thời gian retry
    timerRef.current = setTimeout(() => {
      setRetryCount(nextRetry);
      setActiveSrc(`${src.split('?')[0]}?_t=${Date.now()}`);
    }, delay);
  };

  // Skeleton shimmer khi đang chờ (delay ban đầu hoặc giữa các lần retry)
  if (!activeSrc && !hasError) {
    return html`
      <div
        className=${`${className} zalo-img-skeleton`}
        style=${{ background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
                   backgroundSize: '200% 100%',
                   animation: 'shimmer 1.2s infinite',
                   borderRadius: '8px', minHeight: '80px' }}
      />
    `;
  }

  if (hasError) {
    return html`
      <div
        className=${`${className} zalo-img-error`}
        onClick=${onClick}
        style=${{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                   background: 'rgba(255,255,255,0.05)', borderRadius: '8px',
                   cursor: 'pointer', minHeight: '80px', fontSize: '12px',
                   color: 'rgba(255,255,255,0.4)', flexDirection: 'column', gap: '4px' }}
      >
        <span>🖼️</span>
        <span>Nhấn để xem</span>
      </div>
    `;
  }

  return html`
    <img
      src=${activeSrc}
      className=${className}
      alt=${alt || 'Ảnh Zalo'}
      loading="lazy"
      onError=${handleError}
      onClick=${onClick}
    />
  `;
}


/**
 * ZaloVoicePlayer: Trình phát tin nhắn thoại chuẩn phong cách Zalo PC & Mobile
 */
export function ZaloVoicePlayer({ message, isOutgoing }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const voiceItem = (Array.isArray(message.mediaUrls) && message.mediaUrls[0]) || {};
  const rawVoiceUrl = voiceItem.url || message.voiceUrl || '';
  const voiceUrl = rawVoiceUrl.startsWith('http')
    ? `/api/chat/media-proxy?url=${encodeURIComponent(rawVoiceUrl)}`
    : rawVoiceUrl;
  const rawDuration = voiceItem.duration || message.voiceDuration || 0;

  const [duration, setDuration] = useState(
    rawDuration ? Math.round(rawDuration / 1000) : 0
  );
  const [showStt, setShowStt] = useState(true);
  const audioRef = useRef(null);

  // Trích xuất nội dung phiên âm (nếu có)
  let sttText = '';
  if (message.content) {
    if (message.content.startsWith('[🎙️ Tin nhắn thoại]:')) {
      sttText = message.content.replace('[🎙️ Tin nhắn thoại]:', '').trim().replace(/^["\s]+|["\s]+$/g, '');
    } else if (
      message.content !== '[Tin nhắn thoại]' &&
      message.content !== '[Tin nhắn thoại: Không có URL âm thanh hợp lệ]' &&
      message.content !== '[Tin nhắn thoại: Không thể tải tệp âm thanh]'
    ) {
      sttText = message.content.trim();
    }
  }

  const togglePlay = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !voiceUrl) return;

    if (audio.paused) {
      if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
        currentlyPlayingAudio.pause();
      }
      currentlyPlayingAudio = audio;
      audio.play().catch((err) => console.warn('Lỗi phát âm thanh:', err));
    } else {
      audio.pause();
    }
  };

  const handleSeek = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !voiceUrl) return;
    const waveformEl = e.currentTarget;
    const rect = waveformEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const totalDur = audio.duration || duration || 0;
    if (totalDur > 0) {
      audio.currentTime = percent * totalDur;
      setCurrentTime(audio.currentTime);
    }
  };

  const activeCount = duration > 0 ? Math.round((currentTime / duration) * WAVEFORM_HEIGHTS.length) : 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return html`
    <div className=${`zalo-voice-msg-card ${isOutgoing ? 'is-outgoing' : 'is-incoming'}`}>
      <!-- Hàng trên: Trình phát Audio -->
      <div className="zalo-voice-top-row">
        <!-- Nút Play Tròn Xanh Zalo -->
        <button
          type="button"
          className="zalo-voice-play-circle"
          onClick=${togglePlay}
          title=${isPlaying ? 'Tạm dừng' : 'Phát'}
        >
          ${isPlaying ? html`
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1.5"></rect>
              <rect x="14" y="4" width="4" height="16" rx="1.5"></rect>
            </svg>
          ` : html`
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style=${{ marginLeft: '2px' }}>
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
          `}
        </button>

        <!-- Khu vực Waveform & Thời gian -->
        <div className="zalo-voice-track-wrapper">
          <div className="zalo-voice-waveform-track" onClick=${handleSeek} title="Tua âm thanh">
            <!-- Vạch chỉ báo vị trí phát (Scrubber Bar) -->
            <div
              className="zalo-voice-scrubber"
              style=${{ left: `${progressPercent}%` }}
            ></div>

            <!-- Các cột sóng âm -->
            <div className="zalo-voice-bars">
              ${WAVEFORM_HEIGHTS.map((h, idx) => html`
                <span
                  key=${idx}
                  className=${`zalo-waveform-dot ${idx < activeCount ? 'is-active' : ''}`}
                  style=${{ height: `${h}px` }}
                ></span>
              `)}
            </div>
          </div>

          <!-- Bộ đếm thời gian dưới vạch phát -->
          <div className="zalo-voice-time-label">
            ${formatVoiceTime(currentTime > 0 ? currentTime : duration)}
          </div>
        </div>

        <!-- Nút thu gọn / mở rộng STT (Chevron) -->
        ${sttText && html`
          <button
            type="button"
            className=${`zalo-voice-chevron-btn ${showStt ? 'is-expanded' : ''}`}
            onClick=${() => setShowStt(!showStt)}
            title=${showStt ? 'Thu gọn văn bản' : 'Xem nội dung văn bản'}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
        `}
      </div>

      <!-- Hàng dưới: Nội dung phiên âm STT -->
      ${sttText && showStt && html`
        <div className="zalo-voice-stt-row">
          <div className="zalo-voice-stt-line"></div>
          <div className="zalo-voice-stt-text">${sttText}</div>
        </div>
      `}

      <!-- Audio Element ngầm (chỉ gán src nếu voiceUrl hợp lệ) -->
      ${voiceUrl && html`
        <audio
          ref=${audioRef}
          src=${voiceUrl}
          preload="metadata"
          onPlay=${() => setIsPlaying(true)}
          onPause=${() => setIsPlaying(false)}
          onEnded=${() => {
            setIsPlaying(false);
            setCurrentTime(0);
            if (currentlyPlayingAudio === audioRef.current) currentlyPlayingAudio = null;
          }}
          onTimeUpdate=${(e) => setCurrentTime(e.target.currentTime)}
          onLoadedMetadata=${(e) => {
            if (e.target.duration && !isNaN(e.target.duration)) {
              setDuration(e.target.duration);
            }
          }}
        ></audio>
      `}
    </div>
  `;
}

/**
 * ZaloSticker: Component hiển thị Nhãn dán / Sticker chuẩn phong cách Zalo PC
 */
export function ZaloSticker({ message, isOutgoing }) {
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const stickerItem = (Array.isArray(message.mediaUrls) && message.mediaUrls[0]) || {};
  let caption = stickerItem.description || message.stickerText || '';

  if (!caption && message.content) {
    if (message.content.startsWith('[🏷️ Nhãn dán / Sticker]:')) {
      caption = message.content.replace('[🏷️ Nhãn dán / Sticker]:', '').trim().replace(/^["\s]+|["\s]+$/g, '');
    } else if (message.content.startsWith('[🏷️ Sticker]:')) {
      caption = message.content.replace('[🏷️ Sticker]:', '').trim().replace(/^["\s]+|["\s]+$/g, '');
    } else if (message.content.startsWith('[Nhãn dán]:')) {
      caption = message.content.replace('[Nhãn dán]:', '').trim().replace(/^["\s]+|["\s]+$/g, '');
    }
  }

  if (caption === 'Sticker' || caption === 'Nhãn dán' || caption === 'Nhãn dán biểu cảm' || caption === '[Sticker]') {
    caption = '';
  }

  const stickerId = stickerItem.id || message.stickerId;
  const stickerUrl =
    stickerItem.url ||
    message.stickerUrl ||
    (stickerId ? `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stickerId}&size=130` : '');

  if (!stickerUrl || hasError) {
    return html`
      <div className="zalo-sticker-fallback">
        <span className="zalo-sticker-fallback-icon">🏷️</span>
        <span className="zalo-sticker-fallback-text">${caption || 'Nhãn dán'}</span>
      </div>
    `;
  }

  return html`
    <div className="zalo-sticker-container">
      <div className=${`zalo-sticker-wrapper ${loaded ? 'is-loaded' : 'is-loading'}`}>
        ${!loaded && html`
          <div className="zalo-sticker-skeleton"></div>
        `}
        <img
          src=${stickerUrl}
          alt=${caption || 'Sticker Zalo'}
          className="zalo-sticker-img"
          loading="lazy"
          onLoad=${() => setLoaded(true)}
          onError=${() => setHasError(true)}
        />
      </div>
      ${caption && html`
        <div className="zalo-sticker-caption-badge" title="Ý nghĩa nhãn dán">
          <span className="sticker-badge-dot"></span>
          ${caption}
        </div>
      `}
    </div>
  `;
}

function isValidVoiceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase().split('?')[0];
  return (
    lower.endsWith('.m4a') ||
    lower.endsWith('.aac') ||
    lower.endsWith('.mp3') ||
    lower.endsWith('.wav') ||
    lower.endsWith('.amr') ||
    lower.endsWith('.ogg') ||
    lower.endsWith('.opus') ||
    lower.includes('/voice/') ||
    lower.includes('voicemsg') ||
    lower.includes('audiomsg')
  );
}

export function MessageBubble({ message, ownId, isGroup, onImageClick }) {
  const isOutgoing =
    message.role === 'model' ||
    (ownId && message.senderId === ownId) ||
    message.senderId === 'admin';

  const avatarLetter = (message.senderName || 'U').trim().charAt(0).toUpperCase();

  // Xác định mediaType tường minh
  const mediaType =
    message.mediaType !== undefined && message.mediaType !== null
      ? message.mediaType
      : message.hasSticker || message.stickerUrl || message.stickerId
      ? 'sticker'
      : message.hasVoice || message.voiceUrl
      ? 'voice'
      : message.hasImage || (Array.isArray(message.imageUrls) && message.imageUrls.length > 0)
      ? 'photo'
      : null;

  const mediaItems =
    Array.isArray(message.mediaUrls) && message.mediaUrls.length > 0
      ? message.mediaUrls
      : Array.isArray(message.imageUrls)
      ? message.imageUrls.map((u) => typeof u === 'string' ? { url: u } : u)
      : [];

  const imageUrls =
    mediaType === 'photo'
      ? mediaItems.length > 0
        ? mediaItems.map((m) => (typeof m === 'string' ? m : m?.url)).filter(Boolean)
        : Array.isArray(message.imageUrls)
        ? message.imageUrls.map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean)
        : []
      : [];

  const isSticker = mediaType === 'sticker';
  const isVoice = mediaType === 'voice';
  const isPhoto = mediaType === 'photo' && imageUrls.length > 0;

  const hasRealText = Boolean(
    message.content &&
      message.content.trim() &&
      message.content !== '[Hình ảnh đính kèm]' &&
      message.content !== '[Hình ảnh]' &&
      message.content !== '[Sticker]' &&
      message.content !== '[Nhãn dán]' &&
      message.content !== '[Tin nhắn thoại]' &&
      !message.content.startsWith('[🏷️ Nhãn dán / Sticker]:') &&
      !message.content.startsWith('[🏷️ Sticker]:') &&
      !message.content.startsWith('[Nhãn dán]:')
  );

  const isPureImage = isPhoto && !hasRealText && !message.hasQuote;
  const isPureSticker = isSticker && !message.hasQuote;

  const imageGridClass =
    imageUrls.length === 1
      ? 'grid-1'
      : imageUrls.length === 2
      ? 'grid-2'
      : imageUrls.length <= 4
      ? 'grid-4'
      : 'grid-multi';

  return html`
    <div className=${`message-row ${isOutgoing ? 'outgoing' : 'incoming'} ${isPureImage || isPureSticker ? 'is-pure-image-row' : ''}`}>
      ${!isOutgoing && html`
        <div className="msg-sender-avatar" title=${message.senderName || 'Người gửi'}>
          ${avatarLetter}
        </div>
      `}

      <div className="msg-body-wrapper">
        ${!isOutgoing && isGroup && message.senderName && html`
          <div className="msg-sender-label">${message.senderName}</div>
        `}

        ${isPureSticker ? html`
          <!-- Pure Sticker Mode chuẩn Zalo PC -->
          <div className="msg-pure-sticker-wrapper">
            <${ZaloSticker} message=${message} isOutgoing=${isOutgoing} />
          </div>
        ` : isPureImage ? html`
          <!-- Album ảnh thuần túy hiển thị trực tiếp chuẩn Zalo PC (KHÔNG CÓ KHUNG BUBBLE) -->
          <div className=${`msg-pure-images-container ${imageGridClass}`}>
            ${imageUrls.map((url, idx) => html`
              <${ZaloImageItem}
                key=${idx}
                src=${url}
                className="pure-image-img"
                alt="Ảnh Zalo"
                onClick=${() => onImageClick(url)}
              />
            `)}
          </div>
        ` : html`
          <!-- Bubble Tin Nhắn Zalo PC cho tin nhắn văn bản và tin nhắn kèm ảnh có text -->
          <div className="msg-bubble">
            ${message.hasQuote && message.quoteText && html`
              <div className="msg-quote-card">
                <span className="quote-sender-name">
                  ${message.quoteSenderName || 'Trích dẫn'}
                </span>
                <div className="quote-text-preview">${message.quoteText}</div>
              </div>
            `}

            ${isVoice && html`
              <${ZaloVoicePlayer} message=${message} isOutgoing=${isOutgoing} />
            `}

            ${isSticker && html`
              <${ZaloSticker} message=${message} isOutgoing=${isOutgoing} />
            `}

            ${hasRealText && html`
              <div className="msg-text-content" style=${{ whiteSpace: 'pre-wrap' }}>
                ${message.content}
              </div>
            `}

            ${isPhoto && html`
              <div className=${`msg-images-grid ${imageGridClass}`} style=${hasRealText ? { marginTop: '8px' } : {}}>
                ${imageUrls.map((url, idx) => html`
                  <${ZaloImageItem}
                    key=${idx}
                    src=${url}
                    className="msg-image-thumb"
                    alt="Ảnh Zalo"
                    onClick=${() => onImageClick(url)}
                  />
                `)}
              </div>
            `}
          </div>
        `}

        <div className="msg-meta-row">
          <span className="msg-timestamp">${formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  `;
}
