import React, { useState, useRef, useEffect, useMemo } from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';
import { MessageBubble } from './MessageBubble.js';

const html = htm.bind(React.createElement);

/**
 * Tự động nhóm các tin nhắn ảnh thuần túy gửi gần nhau (trong vòng 15 giây) thành 1 Album ảnh
 */
function groupConsecutiveImageMessages(messages) {
  if (!messages || !messages.length) return [];

  const grouped = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const hasRealText = Boolean(
      msg.content &&
        msg.content.trim() &&
        msg.content !== '[Hình ảnh đính kèm]' &&
        msg.content !== '[Hình ảnh]' &&
        msg.content !== '[Sticker]'
    );
    const isPureImg = Boolean(msg.hasImage && msg.imageUrls?.length > 0 && !hasRealText && !msg.hasQuote);

    const prev = grouped.length > 0 ? grouped[grouped.length - 1] : null;
    const prevHasRealText = Boolean(
      prev?.content &&
        prev.content.trim() &&
        prev.content !== '[Hình ảnh đính kèm]' &&
        prev.content !== '[Hình ảnh]' &&
        prev.content !== '[Sticker]'
    );
    const prevIsPureImg = Boolean(prev?.hasImage && prev?.imageUrls?.length > 0 && !prevHasRealText && !prev?.hasQuote);

    // Điều kiện group: cả 2 đều là pure image, cùng người gửi/role, gửi cách nhau <= 15 giây (15000ms)
    const sameSender = prev && (prev.senderId === msg.senderId || prev.role === msg.role);
    const closeTime = prev && Math.abs(Number(msg.timestamp) - Number(prev.timestamp)) <= 15000;

    if (isPureImg && prevIsPureImg && sameSender && closeTime) {
      // Gộp các ảnh vào tin nhắn trước đó (loại bỏ URL trùng)
      const combinedUrls = Array.from(new Set([...(prev.imageUrls || []), ...(msg.imageUrls || [])]));
      prev.imageUrls = combinedUrls;
      // Cập nhật timestamp về tin nhắn mới nhất
      prev.timestamp = Math.max(Number(prev.timestamp), Number(msg.timestamp));
    } else {
      grouped.push({
        ...msg,
        imageUrls: msg.imageUrls ? [...msg.imageUrls] : [],
      });
    }
  }

  return grouped;
}

export function ChatArea({
  activeThread,
  historyData,
  loadingHistory,
  onBackToSidebar,
  onSendMessage,
  onSendImages,
  onToggleMode,
  onOpenRenameModal,
  onLoadOlderMessages,
  onImageClick,
  ownId,
}) {
  const [inputText, setInputText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [sending, setSending] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // Nhóm các ảnh gửi cùng lúc
  const displayedMessages = useMemo(() => {
    return groupConsecutiveImageMessages(historyData?.messages || []);
  }, [historyData?.messages]);

  // Cuộn xuống tin nhắn mới nhất khi nhận tin mới
  useEffect(() => {
    if (messagesEndRef.current && !loadingHistory) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayedMessages.length]);

  // Tự động điều chỉnh chiều cao textarea
  const handleTextChange = (e) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImages((prev) => [
          ...prev,
          {
            file,
            dataUrl: reader.result,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removeSelectedImage = (index) => {
    setSelectedImages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (sending) return;
    const textToSend = inputText.trim();

    if (selectedImages.length > 0) {
      setSending(true);
      try {
        const imageUrls = selectedImages.map((img) => img.dataUrl);
        await onSendImages(imageUrls, textToSend);
        setSelectedImages([]);
        setInputText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } finally {
        setSending(false);
      }
      return;
    }

    if (!textToSend) return;

    setSending(true);
    try {
      await onSendMessage(textToSend);
      setInputText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } finally {
      setSending(false);
    }
  };

  const handleModeClick = async () => {
    if (togglingMode) return;
    setTogglingMode(true);
    try {
      await onToggleMode();
    } finally {
      setTogglingMode(false);
    }
  };

  if (!activeThread) {
    return html`
      <main className="zalo-chat-area">
        <div className="chat-welcome-view">
          <div className="welcome-badge-icon">💬</div>
          <h2 className="welcome-title">Chào mừng đến với Zalo AI Bot</h2>
          <p className="welcome-desc">
            Chọn một cuộc trò chuyện từ danh sách bên trái hoặc nhấn dấu ＋ để mở đoạn chat mới.
          </p>
        </div>
      </main>
    `;
  }

  const threadName = historyData?.threadName || activeThread.threadName || `Người dùng ${activeThread.threadId}`;
  const isGroup = Boolean(historyData ? historyData.isGroup : activeThread.isGroup);
  const isManual = Boolean(historyData ? historyData.isManual : activeThread.isManual);
  const candidate = historyData?.candidate;
  const avatarLetter = (threadName || 'U').trim().charAt(0).toUpperCase();

  return html`
    <main className="zalo-chat-area">
      <!-- Chat Header -->
      <header className="chat-main-header">
        <div className="chat-header-left">
          <button className="btn-mobile-back" onClick=${onBackToSidebar} title="Quay lại">
            ←
          </button>

          <div className=${`chat-header-avatar ${isGroup ? 'is-group' : ''}`}>
            ${isGroup ? '👥' : avatarLetter}
          </div>

          <div className="chat-header-title-box">
            <div className="chat-header-name-row">
              <h2 className="chat-header-name" title=${threadName}>
                ${threadName}
              </h2>
              <button
                className="btn-rename-trigger"
                title="Đổi tên hiển thị Zalo"
                onClick=${onOpenRenameModal}
              >
                ✏️
              </button>
            </div>
            <div className="chat-header-subinfo">
              ${isGroup ? 'Nhóm trò chuyện' : 'Cuộc trò chuyện cá nhân'} · ID: ${activeThread.threadId}
            </div>
          </div>
        </div>

        <div className="chat-header-right">
          <!-- Nút Chuyển Đổi AI / Thủ Công: CHỈ HIỂN THỊ Ở CHAT CÁ NHÂN -->
          ${!isGroup && html`
            <button
              className=${`mode-toggle-switch ${isManual ? 'is-manual' : 'is-ai'}`}
              onClick=${handleModeClick}
              disabled=${togglingMode}
              title=${isManual ? 'Đang ở chế độ Thủ công (AI không trả lời). Bấm để bật AI' : 'Đang ở chế độ AI tự động. Bấm để chuyển sang Thủ công'}
            >
              <span className="mode-pill-indicator"></span>
              <span>${isManual ? '✋ Thủ công (-M)' : '🤖 AI Tự động'}</span>
            </button>
          `}
        </div>
      </header>

      <!-- Candidate Intelligence Card -->
      ${candidate && (candidate.fullName || candidate.phoneNumber || candidate.targetCompany) && html`
        <div className="candidate-intel-banner">
          <div className="candidate-intel-chips">
            ${candidate.fullName && html`
              <span className="candidate-chip">
                👤 <strong>${candidate.fullName}</strong>
              </span>
            `}
            ${candidate.phoneNumber && html`
              <span className="candidate-chip">
                📞 <strong>${candidate.phoneNumber}</strong>
              </span>
            `}
            ${candidate.targetCompany && html`
              <span className="candidate-chip">
                🏢 <strong>${candidate.targetCompany}</strong>
              </span>
            `}
            ${candidate.interviewTime && html`
              <span className="candidate-chip">
                📅 <strong>${candidate.interviewTime}</strong>
              </span>
            `}
          </div>
        </div>
      `}

      <!-- Messages Scroll Container -->
      <div className="chat-messages-container">
        ${historyData?.hasMoreOlder && html`
          <div className="messages-load-more">
            <button
              className="btn-load-older"
              onClick=${onLoadOlderMessages}
              disabled=${loadingHistory}
            >
              ${loadingHistory ? 'Đang tải tin nhắn cũ...' : '↑ Tải tin nhắn cũ hơn'}
            </button>
          </div>
        `}

        ${displayedMessages.map((msg, idx) => html`
          <${MessageBubble}
            key=${msg.id || idx}
            message=${msg}
            ownId=${ownId}
            isGroup=${isGroup}
            onImageClick=${onImageClick}
          />
        `)}

        <div ref=${messagesEndRef} />
      </div>

      <!-- Chat Input Wrapper -->
      <footer className="chat-input-wrapper">
        ${selectedImages.length > 0 && html`
          <div className="upload-preview-bar">
            <div style=${{ display: 'flex', gap: '8px', overflowX: 'auto', flex: 1, alignItems: 'center' }}>
              ${selectedImages.map((img, idx) => html`
                <div key=${idx} style=${{ position: 'relative', flexShrink: 0 }}>
                  <img
                    src=${img.dataUrl}
                    className="upload-preview-thumb"
                    alt="Preview"
                  />
                  <button
                    onClick=${() => removeSelectedImage(idx)}
                    style=${{
                      position: 'absolute',
                      top: '-6px',
                      right: '-6px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ✕
                  </button>
                </div>
              `)}
            </div>
            <div className="upload-preview-info">
              Đã chọn ${selectedImages.length} hình ảnh
            </div>
            <button
              className="btn-cancel-upload"
              onClick=${() => setSelectedImages([])}
            >
              ✕ Hủy tất cả
            </button>
          </div>
        `}

        <div className="chat-input-form">
          <textarea
            ref=${textareaRef}
            className="chat-textarea"
            placeholder="Nhập tin nhắn... (Enter để gửi, Shift+Enter xuống dòng)"
            rows="1"
            value=${inputText}
            onInput=${handleTextChange}
            onKeyDown=${handleKeyDown}
          />

          <div className="chat-input-actions">
            <!-- Cho phép chọn nhiều ảnh (multiple) -->
            <input
              type="file"
              ref=${fileInputRef}
              accept="image/*"
              multiple
              style=${{ display: 'none' }}
              onChange=${handleFileChange}
            />

            <button
              className="btn-upload-trigger"
              title="Đính kèm hình ảnh (có thể chọn nhiều ảnh)"
              onClick=${() => fileInputRef.current?.click()}
            >
              🖼️
            </button>

            <button
              className="btn-send-message"
              title="Gửi tin nhắn"
              onClick=${handleSubmit}
              disabled=${sending || (!inputText.trim() && selectedImages.length === 0)}
            >
              ➤
            </button>
          </div>
        </div>
      </footer>
    </main>
  `;
}
