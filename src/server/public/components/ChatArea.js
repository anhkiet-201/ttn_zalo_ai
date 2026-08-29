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

  // Cuộn xuống tin nhắn mới nhất
  useEffect(() => {
    if (messagesEndRef.current && !loadingHistory) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayedMessages.length]);

  const handleTextChange = (e) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
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
          <div className="welcome-badge-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h2 className="welcome-title">Zalo AI Bot Assistant</h2>
          <p className="welcome-desc">
            Chọn một cuộc trò chuyện từ danh sách bên trái để xem tin nhắn và quản lý hội thoại.
          </p>
        </div>
      </main>
    `;
  }

  const threadName = historyData?.threadName || activeThread.threadName || `Khách ${activeThread.threadId.slice(-4)}`;
  const isGroup = Boolean(historyData ? historyData.isGroup : activeThread.isGroup);
  const isManual = Boolean(historyData ? historyData.isManual : activeThread.isManual);
  const candidate = historyData?.candidate;
  const avatarLetter = (threadName || 'U').trim().charAt(0).toUpperCase();

  // Quy tắc hiển thị thanh nhập tin nhắn:
  // - Đối với Group: LUÔN HIỆN THANH NHẬP TIN NHẮN
  // - Đối với Chat cá nhân: CHỈ HIỆN KHI Ở CHẾ ĐỘ THỦ CÔNG (isManual = true)
  const canSendInput = isGroup || isManual;

  return html`
    <main className="zalo-chat-area">
      <!-- 1. Header Zalo PC -->
      <header className="chat-main-header">
        <div className="chat-header-left">
          <button className="btn-mobile-back" onClick=${onBackToSidebar} title="Quay lại">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>

          <div className=${`chat-header-avatar ${isGroup ? 'is-group' : ''}`}>
            ${isGroup ? '👥' : avatarLetter}
          </div>

          <div className="chat-header-info">
            <div className="chat-header-title-row">
              <h2 className="chat-header-title" title=${threadName}>
                ${threadName}
              </h2>
              <button
                className="btn-icon-rename"
                title="Đổi tên Zalo"
                onClick=${onOpenRenameModal}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </button>
            </div>
            <div className="chat-header-subtitle">
              ${isGroup ? 'Nhóm trò chuyện' : 'Cuộc trò chuyện cá nhân'} · ID: ${activeThread.threadId}
            </div>
          </div>
        </div>

        <div className="chat-header-right">
          <!-- Nút Switch Chế độ AI / Thủ Công (iOS Style Switch) - CHỈ HIỆN Ở CHAT CÁ NHÂN -->
          ${!isGroup && html`
            <div
              className="ios-mode-switch-wrapper"
              onClick=${handleModeClick}
              title=${isManual ? 'Đang ở chế độ Thủ công. Bấm để bật AI tự động' : 'Đang ở chế độ AI tự động. Bấm để chuyển sang Thủ công'}
            >
              <span className=${`ios-switch-label ${isManual ? 'is-manual' : 'is-ai'}`}>
                ${isManual ? 'Thủ công (-M)' : 'AI Tự động'}
              </span>

              <label className="ios-switch-control" onClick=${(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked=${!isManual}
                  disabled=${togglingMode}
                  onChange=${handleModeClick}
                />
                <span className="ios-switch-slider"></span>
              </label>
            </div>
          `}
        </div>
      </header>

      <!-- 2. Candidate Intelligence Banner (Flat Zalo PC) -->
      ${candidate && (candidate.fullName || candidate.phoneNumber || candidate.targetCompany) && html`
        <div className="candidate-banner-flat">
          ${candidate.fullName && html`
            <span className="candidate-banner-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <strong>${candidate.fullName}</strong>
            </span>
          `}
          ${candidate.phoneNumber && html`
            <span className="candidate-banner-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              <strong>${candidate.phoneNumber}</strong>
            </span>
          `}
          ${candidate.targetCompany && html`
            <span className="candidate-banner-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                <line x1="9" y1="22" x2="9" y2="22.01"></line>
                <line x1="15" y1="22" x2="15" y2="22.01"></line>
              </svg>
              <strong>${candidate.targetCompany}</strong>
            </span>
          `}
          ${candidate.interviewTime && html`
            <span className="candidate-banner-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <strong>${candidate.interviewTime}</strong>
            </span>
          `}
        </div>
      `}

      <!-- 3. Timeline Tin nhắn -->
      <div className="chat-messages-container">
        ${historyData?.hasMoreOlder && html`
          <div className="messages-load-more">
            <button
              className="btn-load-older"
              onClick=${onLoadOlderMessages}
              disabled=${loadingHistory}
            >
              ${loadingHistory ? 'Đang tải tin cũ...' : 'Tải tin nhắn cũ hơn'}
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

      <!-- 4. Chân trang (Footer): CHỈ HIỂN THỊ CHO GROUP HOẶC CHAT CÁ NHÂN Ở CHẾ ĐỘ THỦ CÔNG (-M) -->
      ${canSendInput && html`
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
                        top: '-5px',
                        right: '-5px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        fontSize: '9px',
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
                Hủy tất cả
              </button>
            </div>
          `}

          <!-- Dải icon công cụ (Chỉ giữ nút Đính kèm ảnh) -->
          <div className="chat-input-toolbar">
            <input
              type="file"
              ref=${fileInputRef}
              accept="image/*"
              multiple
              style=${{ display: 'none' }}
              onChange=${handleFileChange}
            />

            <button
              className="btn-tool-outline"
              title="Đính kèm hình ảnh (hỗ trợ gửi nhiều ảnh)"
              onClick=${() => fileInputRef.current?.click()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
            </button>
          </div>

          <!-- Khung soạn thảo text -->
          <div className="chat-input-box-row">
            <textarea
              ref=${textareaRef}
              className="chat-textarea-native"
              placeholder=${`Nhập tin nhắn gửi tới ${threadName}... (Enter để gửi)`}
              rows="1"
              value=${inputText}
              onInput=${handleTextChange}
              onKeyDown=${handleKeyDown}
            />

            <button
              className="btn-native-send"
              title="Gửi"
              onClick=${handleSubmit}
              disabled=${sending || (!inputText.trim() && selectedImages.length === 0)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </footer>
      `}
    </main>
  `;
}
