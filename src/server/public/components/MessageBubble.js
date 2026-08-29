import React, { useState } from 'https://esm.sh/react@19';
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

/**
 * SmartImage: Placeholder Shimmer Loading & Spinner mảnh tinh tế
 */
export function SmartImage({ src, alt, className, onClick }) {
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  return html`
    <div className="smart-image-wrapper" onClick=${onClick}>
      ${!loaded && !hasError && html`
        <div className="image-shimmer-placeholder">
          <div className="shimmer-spinner"></div>
          <span className="shimmer-text">Đang tải...</span>
        </div>
      `}

      ${hasError ? html`
        <div className="image-error-placeholder">
          <span>Không thể tải ảnh</span>
        </div>
      ` : html`
        <img
          src=${src}
          alt=${alt || 'Ảnh Zalo'}
          className=${`${className} ${loaded ? 'is-loaded' : 'is-loading'}`}
          onLoad=${() => setLoaded(true)}
          onError=${() => setHasError(true)}
          loading="lazy"
        />
      `}
    </div>
  `;
}

export function MessageBubble({ message, ownId, isGroup, onImageClick }) {
  const isOutgoing =
    message.role === 'model' ||
    (ownId && message.senderId === ownId) ||
    message.senderId === 'admin';

  const avatarLetter = (message.senderName || 'U').trim().charAt(0).toUpperCase();

  const hasRealText = Boolean(
    message.content &&
      message.content.trim() &&
      message.content !== '[Hình ảnh đính kèm]' &&
      message.content !== '[Hình ảnh]' &&
      message.content !== '[Sticker]'
  );

  const images = Array.isArray(message.imageUrls) ? message.imageUrls.filter(Boolean) : [];
  const hasImages = message.hasImage && images.length > 0;
  const isPureImage = hasImages && !hasRealText && !message.hasQuote;

  const imageGridClass =
    images.length === 1
      ? 'grid-1'
      : images.length === 2
      ? 'grid-2'
      : images.length <= 4
      ? 'grid-4'
      : 'grid-multi';

  return html`
    <div className=${`message-row ${isOutgoing ? 'outgoing' : 'incoming'} ${isPureImage ? 'is-pure-image-row' : ''}`}>
      ${!isOutgoing && html`
        <div className="msg-sender-avatar" title=${message.senderName || 'Người gửi'}>
          ${avatarLetter}
        </div>
      `}

      <div className="msg-body-wrapper">
        ${!isOutgoing && isGroup && message.senderName && html`
          <div className="msg-sender-label">${message.senderName}</div>
        `}

        ${isPureImage ? html`
          <!-- Album ảnh nhóm lại hiển thị trực tiếp chuẩn Zalo PC -->
          <div className=${`msg-pure-images-container ${imageGridClass}`}>
            ${images.map((url, idx) => html`
              <${SmartImage}
                key=${idx}
                src=${url}
                className="pure-image-img"
                alt="Ảnh Zalo"
                onClick=${() => onImageClick(url)}
              />
            `)}
          </div>
        ` : html`
          <!-- Bubble Tin Nhắn Zalo PC -->
          <div className="msg-bubble">
            ${message.hasQuote && message.quoteText && html`
              <div className="msg-quote-card">
                <span className="quote-sender-name">
                  ${message.quoteSenderName || 'Trích dẫn'}
                </span>
                <div className="quote-text-preview">${message.quoteText}</div>
              </div>
            `}

            ${hasRealText && html`
              <div className="msg-text-content" style=${{ whiteSpace: 'pre-wrap' }}>
                ${message.content}
              </div>
            `}

            ${hasImages && html`
              <div className=${`msg-images-grid ${imageGridClass}`} style=${{ marginTop: '6px' }}>
                ${images.map((url, idx) => html`
                  <${SmartImage}
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
