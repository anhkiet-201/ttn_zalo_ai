import type { ChatMessageRecord } from "../database/repositories/chatHistoryRepository.js";

/**
 * renderChatPage: Render giao diện Web Chat chuẩn Zalo PC
 * Nếu không có threadId trong URL -> Hiện popup nhập Thread ID.
 */
export function renderChatPage(threadId: string): string {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zalo AI - Trò Chuyện Trực Tiếp</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --zalo-blue: #0068ff;
      --zalo-blue-hover: #0056d6;
      --zalo-blue-light: #e5efff;
      --zalo-blue-border: #cce0ff;
      --zalo-bg: #eef0f3;
      --zalo-white: #ffffff;
      --zalo-text-primary: #081c36;
      --zalo-text-secondary: #768499;
      --zalo-text-muted: #8896a6;
      --zalo-border: #e5e7eb;
      --font-main: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-main);
      background-color: var(--zalo-bg);
      color: var(--zalo-text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* ==========================================================================
       HEADER APP BAR
       ========================================================================== */
    .zalo-header {
      background: var(--zalo-white);
      height: 64px;
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-bottom: 1px solid var(--zalo-border);
      z-index: 10;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0068ff 0%, #00a2ff 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      box-shadow: 0 2px 8px rgba(0, 104, 255, 0.2);
      flex-shrink: 0;
      position: relative;
    }

    .header-avatar.is-group {
      background: linear-gradient(135deg, #2b569a 0%, #0068ff 100%);
    }

    .online-dot {
      position: absolute;
      bottom: 1px;
      right: 1px;
      width: 11px;
      height: 11px;
      background: #10b981;
      border: 2px solid white;
      border-radius: 50%;
    }

    .header-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .header-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--zalo-text-primary);
      line-height: 1.2;
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 4px;
      margin-left: -4px;
      transition: background 0.15s;
    }

    .header-name:hover {
      background: #f1f5f9;
      color: var(--zalo-blue);
    }

    .btn-quick-rename {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--zalo-text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      transition: all 0.2s ease;
      padding: 0;
      flex-shrink: 0;
    }

    .btn-quick-rename:hover {
      background: var(--zalo-blue-light);
      color: var(--zalo-blue);
    }

    .badge-candidate {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
      border-radius: 20px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 600;
    }

    .header-sub {
      font-size: 13px;
      color: var(--zalo-text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ==========================================================================
       CHAT MESSAGES TIMELINE
       ========================================================================== */
    .zalo-chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 18px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }

    .timeline-date-sep {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 8px 0;
    }

    .timeline-date-pill {
      background: rgba(0, 0, 0, 0.06);
      color: var(--zalo-text-secondary);
      font-size: 11px;
      font-weight: 600;
      padding: 3px 12px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* Message Row */
    .message-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      max-width: 75%;
      position: relative;
    }

    .message-row.incoming {
      align-self: flex-start;
    }

    .message-row.outgoing {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .msg-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #cbd5e1;
      color: #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      user-select: none;
    }

    .message-row.outgoing .msg-avatar {
      display: none;
    }

    .msg-body-wrapper {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: 100%;
    }

    .message-row.incoming .msg-body-wrapper {
      align-items: flex-start;
    }

    .message-row.outgoing .msg-body-wrapper {
      align-items: flex-end;
    }

    .msg-sender-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--zalo-text-secondary);
      margin-left: 2px;
      margin-bottom: 2px;
    }

    /* ==========================================================================
       BUBBLE & MEDIA STYLING (Chuẩn Zalo PC)
       ========================================================================== */
    .msg-bubble {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
      position: relative;
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* Bubble Incoming Text */
    .message-row.incoming .msg-bubble {
      background: var(--zalo-white);
      color: var(--zalo-text-primary);
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      border-top-left-radius: 2px;
    }

    /* Bubble Outgoing Text */
    .message-row.outgoing .msg-bubble {
      background: var(--zalo-blue-light);
      color: var(--zalo-text-primary);
      border: 1px solid var(--zalo-blue-border);
      box-shadow: 0 1px 2px rgba(0, 104, 255, 0.04);
      border-top-right-radius: 2px;
    }

    /* Message chỉ có Ảnh */
    .msg-media-card {
      display: inline-block;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: transparent;
      line-height: 0;
    }

    /* Image Thumbnail */
    .msg-images {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .msg-img-container {
      position: relative;
      display: inline-flex;
      border-radius: 8px;
      overflow: hidden;
      line-height: 0;
    }

    .msg-image-thumb {
      max-width: 340px;
      max-height: 340px;
      display: block;
      border-radius: 8px;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.2s ease;
    }

    .msg-image-thumb:hover {
      transform: scale(1.01);
    }

    /* Upload Progress Overlay */
    .upload-progress-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(3px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: white;
      padding: 12px;
      transition: opacity 0.3s ease;
      z-index: 5;
    }

    .upload-progress-overlay.done {
      opacity: 0;
      pointer-events: none;
    }

    .progress-spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: #0068ff;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-text {
      font-size: 12px;
      font-weight: 600;
      color: #ffffff;
      text-shadow: 0 1px 3px rgba(0,0,0,0.6);
      text-align: center;
      line-height: 1.2;
    }

    .progress-bar-track {
      width: 80%;
      height: 5px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background: #0068ff;
      width: 15%;
      border-radius: 6px;
      transition: width 0.15s ease;
    }

    /* Footer: Thời gian */
    .msg-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
      padding: 0 2px;
    }

    .msg-time {
      font-size: 11px;
      color: var(--zalo-text-muted);
      user-select: none;
    }

    /* ==========================================================================
       TOOLBAR & INPUT AREA
       ========================================================================== */
    .zalo-input-wrapper {
      background: var(--zalo-white);
      border-top: 1px solid var(--zalo-border);
      display: flex;
      flex-direction: column;
      z-index: 10;
    }

    .zalo-toolbar {
      display: flex;
      align-items: center;
      padding: 8px 16px 4px 16px;
      gap: 8px;
    }

    .tool-btn-photo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #0068ff;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tool-btn-photo:hover {
      background: #eff6ff;
      border-color: #bfdbfe;
    }

    /* Main Textarea Row */
    .input-main-row {
      display: flex;
      align-items: flex-end;
      padding: 6px 16px 12px 16px;
      gap: 10px;
    }

    .zalo-textarea {
      flex: 1;
      border: none;
      outline: none;
      font-family: var(--font-main);
      font-size: 14.5px;
      color: var(--zalo-text-primary);
      background: transparent;
      resize: none;
      max-height: 120px;
      min-height: 24px;
      line-height: 1.45;
      padding: 4px 0;
    }

    .zalo-textarea::placeholder {
      color: var(--zalo-text-muted);
    }

    .send-action-btn {
      padding: 7px 18px;
      height: 36px;
      background: var(--zalo-blue);
      color: white;
      border: none;
      border-radius: 6px;
      font-family: var(--font-main);
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease, transform 0.1s ease;
      flex-shrink: 0;
    }

    .send-action-btn svg {
      width: 15px;
      height: 15px;
    }

    .send-action-btn:hover {
      background: var(--zalo-blue-hover);
    }

    .send-action-btn:active {
      transform: scale(0.97);
    }

    .send-action-btn:disabled {
      background: #93c5fd;
      cursor: not-allowed;
    }

    /* ==========================================================================
       POPUP NHẬP THREAD ID (KHI URL THIẾU THREADID)
       ========================================================================== */
    .thread-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(6px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .thread-modal-box {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.25);
      width: 100%;
      max-width: 440px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      animation: modalFadeIn 0.25s ease-out;
    }

    @keyframes modalFadeIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .thread-modal-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--zalo-text-primary);
    }

    .thread-modal-sub {
      font-size: 13.5px;
      color: var(--zalo-text-secondary);
      line-height: 1.4;
    }

    .thread-modal-input {
      width: 100%;
      padding: 10px 14px;
      font-size: 14.5px;
      font-family: var(--font-main);
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      outline: none;
      transition: border-color 0.2s;
    }

    .thread-modal-input:focus {
      border-color: var(--zalo-blue);
      box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.15);
    }

    .thread-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    .thread-modal-submit-btn {
      padding: 9px 20px;
      background: var(--zalo-blue);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      font-family: var(--font-main);
      cursor: pointer;
      transition: background 0.15s;
    }

    .thread-modal-submit-btn:hover {
      background: var(--zalo-blue-hover);
    }

    /* ==========================================================================
       LIGHTBOX ZOOM MODAL
       ========================================================================== */
    .lightbox-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }

    .lightbox-modal.active {
      display: flex;
    }

    .lightbox-img {
      max-width: 90vw;
      max-height: 85vh;
      border-radius: 8px;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
      object-fit: contain;
      animation: zoomIn 0.2s ease-out;
    }

    @keyframes zoomIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .lightbox-close-btn {
      position: absolute;
      top: 20px;
      right: 24px;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    .lightbox-close-btn:hover {
      background: rgba(255, 255, 255, 0.35);
    }

    .lightbox-caption {
      color: #cbd5e1;
      font-size: 13px;
      margin-top: 14px;
      font-weight: 500;
    }

    /* ==========================================================================
       QUICK RENAME MODAL & TOAST STYLING (Chuẩn Zalo PC)
       ========================================================================== */
    .rename-modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(8, 28, 54, 0.45);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: fadeIn 0.2s ease;
    }

    .rename-modal-box {
      background: var(--zalo-white);
      width: 100%;
      max-width: 440px;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(8, 28, 54, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
      overflow: hidden;
      animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }

    .rename-modal-header {
      padding: 18px 20px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .rename-modal-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--zalo-text-primary);
    }

    .rename-modal-close {
      background: transparent;
      border: none;
      font-size: 18px;
      color: var(--zalo-text-secondary);
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .rename-modal-close:hover {
      background: #f1f5f9;
      color: #0f172a;
    }

    .rename-modal-sub {
      padding: 0 20px 16px;
      font-size: 13px;
      color: var(--zalo-text-secondary);
      line-height: 1.4;
    }

    .rename-modal-body {
      padding: 0 20px 20px;
    }

    .rename-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .rename-input {
      width: 100%;
      height: 44px;
      padding: 0 40px 0 14px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
      color: var(--zalo-text-primary);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .rename-input:focus {
      border-color: var(--zalo-blue);
      box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.15);
    }

    .rename-clear-btn {
      position: absolute;
      right: 12px;
      background: #e2e8f0;
      border: none;
      color: #64748b;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      font-size: 11px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .rename-clear-btn:hover {
      background: #cbd5e1;
      color: #1e293b;
    }

    .rename-meta-row {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 12px;
      color: var(--zalo-text-muted);
    }

    .rename-modal-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid var(--zalo-border);
    }

    .btn-rename-cancel {
      padding: 9px 18px;
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-rename-cancel:hover {
      background: #e2e8f0;
    }

    .btn-rename-save {
      padding: 9px 22px;
      background: var(--zalo-blue);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-rename-save:hover {
      background: var(--zalo-blue-hover);
    }

    .btn-rename-save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .zalo-toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-30px);
      background: #1e293b;
      color: white;
      padding: 10px 20px;
      border-radius: 30px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    .zalo-toast.show {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }

    .zalo-toast.success {
      background: #059669;
    }

    .zalo-toast.error {
      background: #dc2626;
    }
  </style>
</head>
<body>

  <!-- 1. HEADER APP BAR -->
  <header class="zalo-header">
    <div class="header-left">
      <div class="header-avatar" id="threadAvatar">
        <span id="avatarLetter">Z</span>
        <div class="online-dot"></div>
      </div>
      <div class="header-info">
        <div class="header-title-row">
          <span class="header-name" id="threadName" title="Nhấp đúp hoặc bấm bút chì để đổi tên">Đang tải...</span>
          <button class="btn-quick-rename" id="btnRename" title="Đổi tên gợi nhớ / Đổi tên nhóm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <span class="badge-candidate" id="candidateBadge" style="display:none;">Ứng viên</span>
        </div>
        <div class="header-sub">
          <span id="threadSubInfo">${threadId || "Chưa chọn thread"}</span>
          <span id="candidateDetails" style="color: #059669; font-weight: 600;"></span>
        </div>
      </div>
    </div>
  </header>

  <!-- 2. CHAT TIMELINE -->
  <main class="zalo-chat-container" id="chatContainer">
    <div class="timeline-date-sep">
      <span class="timeline-date-pill" id="todayPill">Hôm nay</span>
    </div>
  </main>

  <!-- 3. INPUT AREA -->
  <footer class="zalo-input-wrapper">
    <!-- Toolbar: Nút Gửi Ảnh -->
    <div class="zalo-toolbar">
      <button class="tool-btn-photo" id="btnPhoto" title="Chọn ảnh để gửi ngay lập tức">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </button>
    </div>

    <!-- Hidden File Input for Image Upload -->
    <input type="file" id="imageFileInput" accept="image/*" multiple style="display: none;">

    <!-- Input text row -->
    <div class="input-main-row">
      <textarea 
        class="zalo-textarea" 
        id="messageInput" 
        rows="1" 
        placeholder="Nhập @, tin nhắn tới ${threadId || '...'}"
        autofocus
      ></textarea>
      
      <button class="send-action-btn" id="btnSend">
        <span>Gửi</span>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  </footer>

  <!-- 4. MODAL POPUP NHẬP THREAD ID (KHI THIẾU THREADID) -->
  <div class="thread-modal-backdrop" id="threadModal" style="${threadId ? 'display:none;' : 'display:flex;'}">
    <div class="thread-modal-box">
      <div class="thread-modal-title">💬 Nhập Thread ID để bắt đầu</div>
      <div class="thread-modal-sub">Vui lòng nhập User ID hoặc Group ID Zalo để vào khung chat.</div>
      <form id="threadModalForm">
        <input 
          type="text" 
          class="thread-modal-input" 
          id="threadModalInput" 
          placeholder="Ví dụ: 8289935740050353992 hoặc 7022361798516490807" 
          autofocus 
          required 
        />
        <div class="thread-modal-actions">
          <button type="submit" class="thread-modal-submit-btn">Vào trò chuyện</button>
        </div>
      </form>
    </div>
  </div>

  <!-- 5. LIGHTBOX ZOOM MODAL -->
  <div class="lightbox-modal" id="lightboxModal">
    <button class="lightbox-close-btn" id="lightboxClose">✕</button>
    <img class="lightbox-img" id="lightboxImg" src="" alt="Full view">
    <div class="lightbox-caption" id="lightboxCaption"></div>
  </div>

  <!-- 6. MODAL ĐỔI TÊN NHANH (CHUẨN ZALO) -->
  <div class="rename-modal-backdrop" id="renameModal" style="display: none;">
    <div class="rename-modal-box">
      <div class="rename-modal-header">
        <span class="rename-modal-title" id="renameModalTitle">Đổi tên gợi nhớ</span>
        <button class="rename-modal-close" id="renameModalClose" type="button" title="Đóng">✕</button>
      </div>
      <div class="rename-modal-sub" id="renameModalSub">
        Đặt tên gợi nhớ giúp bạn dễ dàng nhận diện và phân loại liên hệ này.
      </div>
      <form id="renameForm" class="rename-modal-body">
        <div class="rename-input-wrap">
          <input 
            type="text" 
            class="rename-input" 
            id="renameInput" 
            placeholder="Nhập tên mới..." 
            maxlength="50" 
            autocomplete="off"
            required
          />
          <button class="rename-clear-btn" id="renameClearBtn" type="button" title="Xóa">✕</button>
        </div>
        <div class="rename-meta-row">
          <span id="renameHint">Tối đa 50 ký tự</span>
          <span id="renameCharCount">0/50</span>
        </div>
        <div class="rename-modal-actions">
          <button type="button" class="btn-rename-cancel" id="btnRenameCancel">Hủy</button>
          <button type="submit" class="btn-rename-save" id="btnRenameSave">Lưu</button>
        </div>
      </form>
    </div>
  </div>

  <!-- 7. TOAST NOTIFICATION -->
  <div class="zalo-toast" id="zaloToast"></div>

  <script>
    (function() {
      const threadId = "${threadId}";
      const chatContainer = document.getElementById("chatContainer");
      const messageInput = document.getElementById("messageInput");
      const btnSend = document.getElementById("btnSend");
      const btnPhoto = document.getElementById("btnPhoto");
      const imageFileInput = document.getElementById("imageFileInput");
      const threadNameEl = document.getElementById("threadName");
      const threadSubInfoEl = document.getElementById("threadSubInfo");
      const avatarLetterEl = document.getElementById("avatarLetter");
      const candidateBadge = document.getElementById("candidateBadge");
      const candidateDetails = document.getElementById("candidateDetails");

      const btnRename = document.getElementById("btnRename");
      const renameModal = document.getElementById("renameModal");
      const renameForm = document.getElementById("renameForm");
      const renameInput = document.getElementById("renameInput");
      const renameModalTitle = document.getElementById("renameModalTitle");
      const renameModalSub = document.getElementById("renameModalSub");
      const renameModalClose = document.getElementById("renameModalClose");
      const btnRenameCancel = document.getElementById("btnRenameCancel");
      const btnRenameSave = document.getElementById("btnRenameSave");
      const renameClearBtn = document.getElementById("renameClearBtn");
      const renameCharCount = document.getElementById("renameCharCount");
      const zaloToast = document.getElementById("zaloToast");

      let isCurrentGroup = false;

      const renderedMessageIds = new Set();
      const threadModalForm = document.getElementById("threadModalForm");
      const threadModalInput = document.getElementById("threadModalInput");

      const lightboxModal = document.getElementById("lightboxModal");
      const lightboxImg = document.getElementById("lightboxImg");
      const lightboxCaption = document.getElementById("lightboxCaption");
      const lightboxClose = document.getElementById("lightboxClose");

      const renderedMessageIds = new Set();

      // Xử lý submit Popup nhập Thread ID
      if (threadModalForm) {
        threadModalForm.addEventListener("submit", function(e) {
          e.preventDefault();
          const val = threadModalInput.value.trim();
          if (val) {
            window.location.href = "/chat?thread=" + encodeURIComponent(val);
          }
        });
      }

      if (!threadId) {
        if (threadModalInput) threadModalInput.focus();
        return;
      }

      // Auto-resize textarea
      messageInput.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });

      // Format time helper
      function formatTime(timestamp) {
        if (!timestamp) return "";
        const d = new Date(timestamp);
        return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      }

      // Loại bỏ các chuỗi text rác/placeholder khi có ảnh
      function sanitizeContent(text) {
        if (!text) return "";
        const trimmed = text.trim();
        const dummyStrings = [
          "[Hình ảnh]",
          "[Người dùng gửi một hình ảnh]",
          "[Hình ảnh đính kèm]",
          "[Ảnh]",
          "[Image]"
        ];
        if (dummyStrings.includes(trimmed)) return "";
        return trimmed;
      }

      // Open Lightbox
      function openLightbox(src, caption) {
        lightboxImg.src = src;
        lightboxCaption.textContent = caption || "";
        lightboxModal.classList.add("active");
      }

      lightboxClose.addEventListener("click", () => lightboxModal.classList.remove("active"));
      lightboxModal.addEventListener("click", (e) => {
        if (e.target === lightboxModal) lightboxModal.classList.remove("active");
      });

      // Nén và giảm kích thước ảnh thông minh phía client để upload siêu tốc
      function compressImageClient(dataUrl, maxWidth = 1920, maxHeight = 1920, quality = 0.86) {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              if (width / height > maxWidth / maxHeight) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            const isPng = dataUrl.startsWith("data:image/png");
            const mime = isPng ? "image/png" : "image/jpeg";
            const compressed = canvas.toDataURL(mime, quality);
            resolve(compressed);
          };
          img.onerror = () => resolve(dataUrl);
          img.src = dataUrl;
        });
      }

      // Tạo một dòng tin nhắn chuẩn Zalo PC
      function createMessageElement(msg, isOptimistic = false) {
        const cleanText = sanitizeContent(msg.content);
        const hasValidImages = Boolean(msg.hasImage && msg.imageUrls && Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0);

        // Guard: Không bao giờ render tin nhắn rỗng (không có chữ và không có ảnh)
        if (!cleanText && !hasValidImages) {
          return null;
        }

        const isSelf = msg.role === "model" || msg.senderId === "642903586588799919" || msg.senderId === "admin";
        const row = document.createElement("div");
        row.className = "message-row " + (isSelf ? "outgoing" : "incoming");
        if (isOptimistic) {
          row.classList.add("temp-pending");
        }
        if (msg.id) {
          row.dataset.id = msg.id;
        }

        row.dataset.content = cleanText;
        const isImageOnly = hasValidImages && !cleanText;

        // Avatar (Incoming)
        if (!isSelf) {
          const avatar = document.createElement("div");
          avatar.className = "msg-avatar";
          const firstChar = (msg.senderName || "U").trim().charAt(0).toUpperCase();
          avatar.textContent = firstChar;
          row.appendChild(avatar);
        }

        // Body Wrapper
        const bodyWrapper = document.createElement("div");
        bodyWrapper.className = "msg-body-wrapper";

        // Tên người gửi (nếu là nhóm và incoming)
        if (!isSelf && msg.senderName) {
          const senderNameEl = document.createElement("span");
          senderNameEl.className = "msg-sender-name";
          senderNameEl.textContent = msg.senderName;
          bodyWrapper.appendChild(senderNameEl);
        }

        // 1. TRƯỜNG HỢP ẢNH THUẦN TÚY (Image-only)
        if (isImageOnly) {
          const imagesContainer = document.createElement("div");
          imagesContainer.className = "msg-images";

          msg.imageUrls.forEach(url => {
            if (!url) return;
            const container = document.createElement("div");
            container.className = "msg-img-container msg-media-card";

            const img = document.createElement("img");
            img.className = "msg-image-thumb";
            img.setAttribute("referrerpolicy", "no-referrer");
            img.src = url;
            img.alt = "Hình ảnh Zalo";
            img.addEventListener("click", () => openLightbox(url, msg.senderName || ""));
            
            img.onerror = function() {
              container.style.display = "none";
            };

            container.appendChild(img);

            // Nếu đang tải lên -> Thêm progress bar
            if (isOptimistic) {
              const progressOverlay = document.createElement("div");
              progressOverlay.className = "upload-progress-overlay";
              progressOverlay.innerHTML = \`
                <div class="progress-spinner"></div>
                <div class="progress-text">Đang gửi 15%...</div>
                <div class="progress-bar-track">
                  <div class="progress-bar-fill" style="width: 15%;"></div>
                </div>
              \`;
              container.appendChild(progressOverlay);
            }

            imagesContainer.appendChild(container);
          });

          bodyWrapper.appendChild(imagesContainer);
        } 
        // 2. TRƯỜNG HỢP CÓ CHỮ (HOẶC CHỮ KÈM ẢNH)
        else {
          const bubble = document.createElement("div");
          bubble.className = "msg-bubble";

          if (cleanText) {
            const textEl = document.createElement("div");
            if (cleanText === "[Sticker]") {
              textEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;font-style:italic;color:#475569;">🏷️ [Nhãn dán / Sticker]</span>';
            } else {
              textEl.textContent = cleanText;
            }
            bubble.appendChild(textEl);
          }

          if (hasValidImages) {
            const imagesContainer = document.createElement("div");
            imagesContainer.className = "msg-images";
            imagesContainer.style.marginTop = cleanText ? "8px" : "0";

            msg.imageUrls.forEach(url => {
              if (!url) return;
              const container = document.createElement("div");
              container.className = "msg-img-container";

              const img = document.createElement("img");
              img.className = "msg-image-thumb";
              img.setAttribute("referrerpolicy", "no-referrer");
              img.src = url;
              img.alt = "Hình ảnh Zalo";
              img.addEventListener("click", () => openLightbox(url, msg.senderName || ""));

              img.onerror = function() {
                container.style.display = "none";
              };

              container.appendChild(img);

              if (isOptimistic) {
                const progressOverlay = document.createElement("div");
                progressOverlay.className = "upload-progress-overlay";
                progressOverlay.innerHTML = \`
                  <div class="progress-spinner"></div>
                  <div class="progress-text">Đang gửi 15%...</div>
                  <div class="progress-bar-track">
                    <div class="progress-bar-fill" style="width: 15%;"></div>
                  </div>
                \`;
                container.appendChild(progressOverlay);
              }

              imagesContainer.appendChild(container);
            });

            bubble.appendChild(imagesContainer);
          }

          bodyWrapper.appendChild(bubble);
        }

        // Meta (Time - Chỉ duy nhất 1 dòng thời gian bên dưới)
        const metaRow = document.createElement("div");
        metaRow.className = "msg-meta-row";

        const timeEl = document.createElement("span");
        timeEl.className = "msg-time";
        timeEl.textContent = formatTime(msg.timestamp) + (isSelf ? " ✓" : "");
        metaRow.appendChild(timeEl);

        bodyWrapper.appendChild(metaRow);
        row.appendChild(bodyWrapper);

        return row;
      }

      function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }

      // Tải lịch sử chat
      async function loadHistory() {
        try {
          const res = await fetch("/api/chat/history?thread=" + encodeURIComponent(threadId));
          const data = await res.json();

          if (data.threadName) {
            threadNameEl.textContent = data.threadName;
            messageInput.placeholder = "Nhập @, tin nhắn tới " + data.threadName + "...";
            avatarLetterEl.textContent = data.threadName.trim().charAt(0).toUpperCase();
            document.title = data.threadName + " - Trò Chuyện Trực Tiếp";
          }

          if (data.isGroup) {
            isCurrentGroup = true;
            document.getElementById("threadAvatar").classList.add("is-group");
          } else {
            isCurrentGroup = false;
          }

          threadSubInfoEl.textContent = threadId;

          if (data.candidate) {
            candidateBadge.style.display = "inline-flex";
            const c = data.candidate;
            candidateDetails.textContent = "• Ứng viên: " + (c.fullName || c.senderName) + " (SĐT: " + (c.phoneNumber || "Chưa có") + " | " + (c.targetCompany || "Chưa có cty") + ")";
          }

          const list = data.messages || data.history || [];
          if (Array.isArray(list)) {
            list.forEach(msg => {
              if (msg.id) renderedMessageIds.add(msg.id);
              const el = createMessageElement(msg);
              if (el) chatContainer.appendChild(el);
            });
            scrollToBottom();
          }
        } catch (err) {
          console.error("Lỗi khi tải lịch sử tin nhắn:", err);
        }
      }

      // ==========================================================================
      // XỬ LÝ GỬI 1 ẢNH TRỰC TIẾP VỚI XHR PROGRESS
      // ==========================================================================
      function uploadImageWithProgress(dataUrl, filename, progressEl) {
        return new Promise((resolve, reject) => {
          const textEl = progressEl ? progressEl.querySelector(".progress-text") : null;
          const fillEl = progressEl ? progressEl.querySelector(".progress-bar-fill") : null;

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/chat/send-image");
          xhr.setRequestHeader("Content-Type", "application/json");

          xhr.upload.onprogress = function(event) {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 85);
              if (textEl) textEl.textContent = "Đang gửi " + percent + "%...";
              if (fillEl) fillEl.style.width = percent + "%";
            }
          };

          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const res = JSON.parse(xhr.responseText);
                if (res.success) {
                  if (textEl) textEl.textContent = "✓ Đã gửi Zalo!";
                  if (fillEl) fillEl.style.width = "100%";
                  setTimeout(() => {
                    if (progressEl) progressEl.classList.add("done");
                  }, 500);
                  resolve(res);
                } else {
                  if (textEl) textEl.textContent = "⚠️ " + (res.error || "Thất bại");
                  reject(new Error(res.error || "Lỗi gửi ảnh"));
                }
              } catch (e) {
                reject(e);
              }
            } else {
              if (textEl) textEl.textContent = "⚠️ Lỗi máy chủ";
              reject(new Error("Lỗi HTTP " + xhr.status));
            }
          };

          xhr.onerror = function() {
            if (textEl) textEl.textContent = "⚠️ Lỗi mạng";
            reject(new Error("Lỗi kết nối mạng"));
          };

          const payload = JSON.stringify({
            threadId: threadId,
            imageBase64: dataUrl,
            filename: filename || "upload.png",
          });

          if (textEl) textEl.textContent = "Đang chuẩn bị...";
          xhr.send(payload);
        });
      }

      // Hàm gửi ảnh ngay lập tức
      async function sendSingleImageDirectly(dataUrl, filename) {
        const tempMsg = {
          role: "model",
          senderId: "642903586588799919",
          senderName: "Admin (Tôi)",
          content: "",
          hasImage: true,
          imageUrls: [dataUrl],
          timestamp: Date.now(),
        };
        const tempEl = createMessageElement(tempMsg, true);
        if (tempEl) {
          chatContainer.appendChild(tempEl);
          scrollToBottom();
        }

        const progressEl = tempEl ? tempEl.querySelector(".upload-progress-overlay") : null;

        try {
          await uploadImageWithProgress(dataUrl, filename, progressEl);
        } catch (err) {
          console.error("Lỗi khi gửi ảnh lên server:", err);
          if (progressEl) {
            const textEl = progressEl.querySelector(".progress-text");
            if (textEl) textEl.textContent = "❌ Gửi thất bại";
          }
          alert("Lỗi khi gửi ảnh tới Zalo: " + (err.message || "Không rõ nguyên nhân"));
        }
      }

      // 1. Nút "Gửi ảnh" -> Mở File Dialog -> Chọn file là GỬI NGAY LẬP TỨC!
      btnPhoto.addEventListener("click", () => imageFileInput.click());

      imageFileInput.addEventListener("change", function() {
        const files = Array.from(this.files || []);
        if (files.length === 0) return;
        this.value = ""; // reset

        files.forEach(file => {
          const reader = new FileReader();
          reader.onload = async function(e) {
            const compressed = await compressImageClient(e.target.result);
            await sendSingleImageDirectly(compressed, file.name);
          };
          reader.readAsDataURL(file);
        });
      });

      // 2. Paste ảnh từ Clipboard (Ctrl+V / Cmd+V) -> GỬI NGAY LẬP TỨC!
      window.addEventListener("paste", function(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
          if (item.type.indexOf("image") === 0) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = async function(event) {
              const compressed = await compressImageClient(event.target.result);
              await sendSingleImageDirectly(compressed, "pasted_image.png");
            };
            reader.readAsDataURL(blob);
          }
        }
      });

      // 3. Drag & Drop ảnh -> GỬI NGAY LẬP TỨC!
      window.addEventListener("dragover", (e) => e.preventDefault());
      window.addEventListener("drop", function(e) {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files || []);
        files.forEach(file => {
          if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = async function(event) {
              const compressed = await compressImageClient(event.target.result);
              await sendSingleImageDirectly(compressed, file.name);
            };
            reader.readAsDataURL(file);
          }
        });
      });

      // Xử lý gửi tin nhắn Text
      async function handleSendMessage() {
        const text = messageInput.value.trim();
        if (!text) return;

        btnSend.disabled = true;

        const tempMsg = {
          role: "model",
          senderId: "642903586588799919",
          senderName: "Admin (Tôi)",
          content: text,
          timestamp: Date.now(),
        };

        const tempEl = createMessageElement(tempMsg, true);
        if (tempEl) {
          chatContainer.appendChild(tempEl);
          scrollToBottom();
        }

        messageInput.value = "";
        messageInput.style.height = "auto";

        try {
          const res = await fetch("/api/chat/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: threadId,
              message: text,
            }),
          });
          const resData = await res.json();
          if (!resData.success) {
            alert("Lỗi khi gửi tin nhắn: " + (resData.error || "Không rõ"));
          }
        } catch (err) {
          console.error("Lỗi gửi tin nhắn:", err);
          alert("Lỗi kết nối khi gửi tin nhắn!");
        } finally {
          btnSend.disabled = false;
        }
      }

      // Nút Gửi & Enter
      btnSend.addEventListener("click", handleSendMessage);
      messageInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });

      // ==========================================================================
      // REALTIME SSE (Server-Sent Events) với Cơ Chế Chống Duplicate Tuyệt Đối
      // ==========================================================================
      let sseEventSource = null;
      function setupRealtimeSSE() {
        if (sseEventSource) sseEventSource.close();
        sseEventSource = new EventSource("/api/chat/events?thread=" + encodeURIComponent(threadId));

        sseEventSource.onmessage = function(event) {
          try {
            const newMsg = JSON.parse(event.data);
            if (!newMsg) return;

            // Xử lý sự kiện đổi tên thread thời gian thực
            if (newMsg.type === "thread_renamed" && newMsg.newName) {
              threadNameEl.textContent = newMsg.newName;
              messageInput.placeholder = "Nhập @, tin nhắn tới " + newMsg.newName + "...";
              avatarLetterEl.textContent = newMsg.newName.trim().charAt(0).toUpperCase();
              document.title = newMsg.newName + " - Trò Chuyện Trực Tiếp";
              showToast("✓ Đã cập nhật tên: " + newMsg.newName, "success");
              return;
            }

            if (newMsg.id && renderedMessageIds.has(newMsg.id)) {
              return;
            }

            const cleanContent = sanitizeContent(newMsg.content);
            const hasImages = Boolean(newMsg.hasImage && newMsg.imageUrls && newMsg.imageUrls.length > 0);

            // Bỏ qua tin nhắn rỗng không có chữ lẫn ảnh
            if (!cleanContent && !hasImages) return;

            // 1. Reconcile với tin nhắn tạm đang chờ (optimistic temp)
            const pendingTemps = chatContainer.querySelectorAll(".message-row.temp-pending");
            let reconciled = false;
            for (const tempEl of pendingTemps) {
              if (
                (tempEl.dataset.content === cleanContent || (hasImages && tempEl.querySelector(".msg-images"))) &&
                newMsg.role === "model"
              ) {
                tempEl.classList.remove("temp-pending");
                if (newMsg.id) {
                  tempEl.dataset.id = newMsg.id;
                  renderedMessageIds.add(newMsg.id);
                }
                const timeEl = tempEl.querySelector(".msg-time");
                if (timeEl) timeEl.textContent = formatTime(newMsg.timestamp) + " ✓";
                const progressOverlay = tempEl.querySelector(".upload-progress-overlay");
                if (progressOverlay) progressOverlay.classList.add("done");
                reconciled = true;
                break;
              }
            }

            // 2. Chống duplicate với tin nhắn cuối cùng vừa được render
            if (!reconciled) {
              const allRows = chatContainer.querySelectorAll(".message-row");
              if (allRows.length > 0) {
                const lastRow = allRows[allRows.length - 1];
                const lastContent = lastRow.dataset.content || "";
                const lastHasImage = Boolean(lastRow.querySelector(".msg-images"));
                const lastIsOutgoing = lastRow.classList.contains("outgoing");
                const newIsOutgoing = (newMsg.role === "model" || newMsg.senderId === "642903586588799919" || newMsg.senderId === "admin");

                if (
                  lastIsOutgoing === newIsOutgoing &&
                  ((cleanContent && lastContent === cleanContent) || (hasImages && lastHasImage))
                ) {
                  // Tin nhắn trùng lặp vừa được hiển thị, cập nhật id và bỏ qua
                  if (newMsg.id) {
                    lastRow.dataset.id = newMsg.id;
                    renderedMessageIds.add(newMsg.id);
                  }
                  return;
                }
              }

              if (newMsg.id) renderedMessageIds.add(newMsg.id);
              const el = createMessageElement(newMsg);
              if (el) {
                chatContainer.appendChild(el);
                scrollToBottom();
              }
            }
          } catch (err) {
            console.error("Lỗi khi xử lý SSE:", err);
          }
        };
      }

      // ==========================================================================
      // XỬ LÝ ĐỔI TÊN NHANH (QUICK RENAME CHUẨN ZALO)
      // ==========================================================================
      function showToast(text, type = "success") {
        if (!zaloToast) return;
        zaloToast.className = "zalo-toast " + type;
        zaloToast.textContent = text;
        zaloToast.classList.add("show");
        setTimeout(() => {
          zaloToast.classList.remove("show");
        }, 3000);
      }

      function updateCharCount() {
        const len = renameInput.value.length;
        renameCharCount.textContent = len + "/50";
        renameClearBtn.style.display = len > 0 ? "flex" : "none";
      }

      function openRenameModal() {
        if (!threadId) return;
        const currentName = (threadNameEl.textContent || "").trim();
        const cleanName =
          currentName === "Đang tải..." ||
          currentName.startsWith("Người dùng ") ||
          currentName.startsWith("Nhóm ")
            ? ""
            : currentName;

        renameModalTitle.textContent = isCurrentGroup ? "Đổi tên nhóm" : "Đổi tên gợi nhớ";
        renameModalSub.textContent = isCurrentGroup
          ? "Tên nhóm mới sẽ hiển thị cho tất cả thành viên trong nhóm chat."
          : "Đặt tên gợi nhớ giúp bạn dễ dàng nhận diện và phân loại liên hệ này.";

        renameInput.value = cleanName;
        updateCharCount();
        renameModal.style.display = "flex";
        setTimeout(() => {
          renameInput.focus();
          renameInput.select();
        }, 50);
      }

      function closeRenameModal() {
        renameModal.style.display = "none";
        renameInput.value = "";
      }

      if (btnRename) btnRename.addEventListener("click", openRenameModal);
      if (threadNameEl) threadNameEl.addEventListener("dblclick", openRenameModal);
      if (renameModalClose) renameModalClose.addEventListener("click", closeRenameModal);
      if (btnRenameCancel) btnRenameCancel.addEventListener("click", closeRenameModal);

      if (renameClearBtn) {
        renameClearBtn.addEventListener("click", function() {
          renameInput.value = "";
          updateCharCount();
          renameInput.focus();
        });
      }

      if (renameInput) {
        renameInput.addEventListener("input", updateCharCount);
      }

      if (renameModal) {
        renameModal.addEventListener("click", function(e) {
          if (e.target === renameModal) closeRenameModal();
        });
      }

      window.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && renameModal && renameModal.style.display === "flex") {
          closeRenameModal();
        }
      });

      if (renameForm) {
        renameForm.addEventListener("submit", async function(e) {
          e.preventDefault();
          const newName = renameInput.value.trim();
          if (!newName) return;

          btnRenameSave.disabled = true;
          btnRenameSave.textContent = "Đang lưu...";

          try {
            const res = await fetch("/api/chat/rename", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                threadId: threadId,
                newName: newName,
                isGroup: isCurrentGroup,
              }),
            });
            const data = await res.json();
            if (data.success) {
              threadNameEl.textContent = newName;
              messageInput.placeholder = "Nhập @, tin nhắn tới " + newName + "...";
              avatarLetterEl.textContent = newName.trim().charAt(0).toUpperCase();
              document.title = newName + " - Trò Chuyện Trực Tiếp";
              showToast("✓ Đã đổi tên thành công!", "success");
              closeRenameModal();
            } else {
              showToast("⚠️ " + (data.error || "Không thể đổi tên"), "error");
            }
          } catch (err) {
            console.error("Lỗi khi đổi tên:", err);
            showToast("⚠️ Lỗi kết nối máy chủ", "error");
          } finally {
            btnRenameSave.disabled = false;
            btnRenameSave.textContent = "Lưu";
          }
        });
      }

      // Khởi động
      loadHistory();
      setupRealtimeSSE();
    })();
  </script>
</body>
</html>
  `;
}
