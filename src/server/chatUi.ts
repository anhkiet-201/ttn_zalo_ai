import type { ChatMessageRecord } from "../database/repositories/chatHistoryRepository.js";

/**
 * renderChatPage: Render giao diện Web Chat chuẩn Zalo PC 2 cột (Sidebar Danh sách chat + Khung chat chi tiết)
 * Tích hợp Lazy Loading / Infinite Scroll cho cả danh sách thread và lịch sử tin nhắn cũ.
 */
export function renderChatPage(initialThreadId: string = "", initialOwnId: string = ""): string {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zalo AI - Trò Chuyện Trực Tiếp</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --zalo-blue: #0068ff;
      --zalo-blue-hover: #0056d6;
      --zalo-blue-light: #e5efff;
      --zalo-blue-border: #cce0ff;
      --zalo-bg: #eef0f3;
      --zalo-white: #ffffff;
      --zalo-sidebar-bg: #ffffff;
      --zalo-item-hover: #f1f5f9;
      --zalo-item-active: #e5efff;
      --zalo-text-primary: #081c36;
      --zalo-text-secondary: #64748b;
      --zalo-text-muted: #94a3b8;
      --zalo-border: #e2e8f0;
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
      flex-direction: row;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* ==========================================================================
       LAYOUT CHÍNH (2 CỘT ZALO PC)
       ========================================================================== */
    .zalo-layout-wrapper {
      display: flex;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    /* ==========================================================================
       CỘT TRÁI: SIDEBAR DANH SÁCH CHAT (THREADS LIST)
       ========================================================================== */
    .zalo-sidebar {
      width: 360px;
      min-width: 320px;
      max-width: 420px;
      height: 100%;
      background: var(--zalo-sidebar-bg);
      border-right: 1px solid var(--zalo-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      z-index: 20;
    }

    /* Sidebar Header */
    .sidebar-header {
      padding: 16px 16px 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border-bottom: 1px solid var(--zalo-border);
      background: var(--zalo-white);
    }

    .sidebar-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 800;
      color: var(--zalo-blue);
      letter-spacing: -0.3px;
    }

    .sidebar-brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, #0068ff 0%, #00a2ff 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .btn-new-thread {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--zalo-border);
      background: #f8fafc;
      color: var(--zalo-text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-new-thread:hover {
      background: var(--zalo-blue-light);
      color: var(--zalo-blue);
      border-color: var(--zalo-blue-border);
    }

    /* Search Box */
    .sidebar-search-box {
      position: relative;
      display: flex;
      align-items: center;
    }

    .sidebar-search-input {
      width: 100%;
      height: 38px;
      background: #f1f5f9;
      border: 1px solid transparent;
      border-radius: 20px;
      padding: 0 34px 0 36px;
      font-size: 13.5px;
      font-family: inherit;
      color: var(--zalo-text-primary);
      outline: none;
      transition: all 0.2s ease;
    }

    .sidebar-search-input:focus {
      background: #ffffff;
      border-color: var(--zalo-blue);
      box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.12);
    }

    .search-icon-left {
      position: absolute;
      left: 12px;
      color: var(--zalo-text-muted);
      pointer-events: none;
      display: flex;
      align-items: center;
    }

    .search-clear-btn {
      position: absolute;
      right: 10px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: none;
      background: #cbd5e1;
      color: white;
      font-size: 10px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
    }

    /* Filter Tabs */
    .sidebar-filter-tabs {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .sidebar-filter-tabs::-webkit-scrollbar {
      display: none;
    }

    .filter-tab-btn {
      padding: 5px 12px;
      border-radius: 16px;
      border: 1px solid var(--zalo-border);
      background: #f8fafc;
      color: var(--zalo-text-secondary);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .filter-tab-btn.active {
      background: var(--zalo-blue);
      color: #ffffff;
      border-color: var(--zalo-blue);
    }

    /* Threads Scroll List */
    .sidebar-threads-container {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      position: relative;
    }

    /* Thread Item Card */
    .thread-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      transition: background 0.15s ease;
      position: relative;
      border-bottom: 1px solid rgba(0, 0, 0, 0.03);
    }

    .thread-item:hover {
      background: var(--zalo-item-hover);
    }

    .thread-item.active {
      background: var(--zalo-item-active);
    }

    .thread-item.active::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: var(--zalo-blue);
      border-top-right-radius: 4px;
      border-bottom-right-radius: 4px;
    }

    .thread-item-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0068ff 0%, #00a2ff 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 17px;
      flex-shrink: 0;
      position: relative;
      user-select: none;
    }

    .thread-item-avatar.is-group {
      background: linear-gradient(135deg, #2b569a 0%, #0068ff 100%);
    }

    .thread-online-dot {
      position: absolute;
      bottom: 1px;
      right: 1px;
      width: 12px;
      height: 12px;
      background: #10b981;
      border: 2px solid white;
      border-radius: 50%;
    }

    .thread-item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .thread-item-row1 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .thread-item-name {
      font-size: 14.5px;
      font-weight: 700;
      color: var(--zalo-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .thread-item-time {
      font-size: 11.5px;
      color: var(--zalo-text-muted);
      white-space: nowrap;
      font-weight: 500;
    }

    .thread-item-row2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .thread-item-preview {
      font-size: 13px;
      color: var(--zalo-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }

    .thread-item-preview.is-self {
      color: var(--zalo-text-muted);
    }

    .thread-badge-group {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .thread-badge-candidate {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
      border-radius: 12px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 700;
    }

    .thread-badge-manual {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 700;
    }

    /* Skeleton Loading & Infinite Scroll Loader */
    .threads-loader-sentinel {
      padding: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--zalo-text-muted);
      font-size: 12.5px;
      gap: 8px;
    }

    .threads-spinner-sm {
      width: 18px;
      height: 18px;
      border: 2px solid #e2e8f0;
      border-top-color: var(--zalo-blue);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    .empty-threads-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--zalo-text-secondary);
      font-size: 13.5px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    /* ==========================================================================
       CỘT PHẢI: KHUNG TRÒ CHUYỆN CHI TIẾT (MAIN CHAT AREA)
       ========================================================================== */
    .zalo-main-chat {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--zalo-bg);
      position: relative;
      overflow: hidden;
      min-width: 0;
    }

    /* Welcome Empty View (khi chưa chọn thread) */
    .zalo-welcome-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
      background: #ffffff;
      color: var(--zalo-text-secondary);
    }

    .welcome-illustration {
      width: 120px;
      height: 120px;
      border-radius: 30px;
      background: linear-gradient(135deg, #e5efff 0%, #cce0ff 100%);
      color: var(--zalo-blue);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 54px;
      margin-bottom: 24px;
      box-shadow: 0 10px 30px rgba(0, 104, 255, 0.1);
    }

    .welcome-title {
      font-size: 22px;
      font-weight: 800;
      color: var(--zalo-text-primary);
      margin-bottom: 8px;
    }

    .welcome-desc {
      font-size: 14.5px;
      max-width: 440px;
      line-height: 1.6;
      color: var(--zalo-text-secondary);
      margin-bottom: 24px;
    }

    .welcome-quick-btn {
      padding: 10px 20px;
      border-radius: 12px;
      background: var(--zalo-blue);
      color: white;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .welcome-quick-btn:hover {
      background: var(--zalo-blue-hover);
    }

    /* Chat Detail Active View */
    .zalo-chat-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Header App Bar */
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
      min-width: 0;
    }

    .btn-back-sidebar {
      display: none;
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 20px;
      color: var(--zalo-text-secondary);
      padding: 4px;
      border-radius: 6px;
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

    .header-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      flex-shrink: 0;
    }

    .header-sub {
      font-size: 13px;
      color: var(--zalo-text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    /* Switch Mode Button */
    .mode-switch-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
      user-select: none;
    }

    .mode-switch-btn.is-ai {
      background: #eff6ff;
      color: #0068ff;
      border-color: #bfdbfe;
    }

    .mode-switch-btn.is-manual {
      background: #fffbeb;
      color: #d97706;
      border-color: #fde68a;
    }

    .mode-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Chat Messages Timeline */
    .zalo-chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 18px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: auto;
    }

    /* Older Messages Loader Banner */
    .older-messages-loader {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      margin-bottom: 8px;
    }

    .btn-load-older {
      background: #ffffff;
      border: 1px solid var(--zalo-border);
      border-radius: 16px;
      padding: 4px 14px;
      font-size: 12px;
      font-weight: 600;
      color: var(--zalo-blue);
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }

    .btn-load-older:hover {
      background: var(--zalo-blue-light);
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

    /* Message Rows */
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

    .msg-bubble {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
      position: relative;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .message-row.incoming .msg-bubble {
      background: var(--zalo-white);
      color: var(--zalo-text-primary);
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      border-top-left-radius: 2px;
    }

    .message-row.outgoing .msg-bubble {
      background: var(--zalo-blue-light);
      color: var(--zalo-text-primary);
      border: 1px solid var(--zalo-blue-border);
      box-shadow: 0 1px 2px rgba(0, 104, 255, 0.04);
      border-top-right-radius: 2px;
    }

    /* Quote / Reply Card */
    .msg-quote-card {
      background: rgba(0, 0, 0, 0.04);
      border-left: 3px solid var(--zalo-blue);
      border-radius: 4px;
      padding: 4px 8px;
      margin-bottom: 6px;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .message-row.outgoing .msg-quote-card {
      background: rgba(0, 104, 255, 0.08);
      border-left-color: var(--zalo-blue);
    }

    .quote-sender {
      font-weight: 700;
      color: var(--zalo-blue);
      font-size: 11.5px;
    }

    .quote-text {
      color: var(--zalo-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 280px;
    }

    .msg-media-card {
      display: inline-block;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: transparent;
      line-height: 0;
    }

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
      max-width: 320px;
      max-height: 320px;
      display: block;
      border-radius: 8px;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.15s ease;
    }

    .msg-image-thumb:hover {
      transform: scale(1.01);
    }

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
      width: 26px;
      height: 26px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: #0068ff;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-text {
      font-size: 11px;
      font-weight: 600;
      color: #ffffff;
      text-align: center;
    }

    .progress-bar-track {
      width: 80%;
      height: 4px;
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

    /* AI Active Banner */
    .ai-active-banner {
      background: #eff6ff;
      border-top: 1px solid #bfdbfe;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      z-index: 10;
    }

    .ai-banner-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .ai-banner-icon-box {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #0068ff;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .ai-banner-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #1e3a8a;
    }

    .ai-banner-sub {
      font-size: 12px;
      color: #3b82f6;
    }

    .btn-activate-manual {
      background: #ffffff;
      border: 1px solid #93c5fd;
      color: #0068ff;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .btn-activate-manual:hover {
      background: #0068ff;
      color: #ffffff;
      border-color: #0068ff;
    }

    /* Input Toolbar & Area */
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

    .input-main-row {
      display: flex;
      align-items: flex-end;
      padding: 6px 16px 14px 16px;
      gap: 12px;
    }

    .zalo-textarea {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      font-family: inherit;
      font-size: 14.5px;
      line-height: 1.45;
      max-height: 120px;
      min-height: 24px;
      padding: 4px 0;
      color: var(--zalo-text-primary);
    }

    .send-action-btn {
      background: var(--zalo-blue);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }

    .send-action-btn:hover {
      background: var(--zalo-blue-hover);
    }

    .send-action-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Modals, Lightbox, Toast */
    .lightbox-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: none;
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
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      object-fit: contain;
    }

    .lightbox-close-btn {
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
    }

    /* Rename & Thread Modal */
    .thread-modal-backdrop, .rename-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(4px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .thread-modal-box, .rename-modal-box {
      background: white;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      animation: modalPop 0.2s ease-out;
    }

    @keyframes modalPop {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .thread-modal-title, .rename-modal-title {
      font-size: 17px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .thread-modal-sub, .rename-modal-sub {
      font-size: 13px;
      color: var(--zalo-text-secondary);
      margin-bottom: 18px;
      line-height: 1.4;
    }

    .thread-modal-input, .rename-input {
      width: 100%;
      height: 42px;
      border: 1px solid var(--zalo-border);
      border-radius: 10px;
      padding: 0 14px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      margin-bottom: 16px;
    }

    .thread-modal-input:focus, .rename-input:focus {
      border-color: var(--zalo-blue);
      box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.12);
    }

    .thread-modal-actions, .rename-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-modal-cancel, .btn-rename-cancel {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--zalo-border);
      background: #f8fafc;
      color: var(--zalo-text-secondary);
      font-weight: 600;
      font-size: 13.5px;
      cursor: pointer;
    }

    .thread-modal-submit-btn, .btn-rename-save {
      padding: 8px 18px;
      border-radius: 8px;
      border: none;
      background: var(--zalo-blue);
      color: white;
      font-weight: 700;
      font-size: 13.5px;
      cursor: pointer;
    }

    /* Toast */
    .zalo-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: white;
      padding: 10px 18px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 9999;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }

    .zalo-toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    .zalo-toast.success { background: #059669; }
    .zalo-toast.error { background: #dc2626; }

    /* Responsive Mobile */
    @media (max-width: 768px) {
      .zalo-sidebar {
        width: 100vw;
        max-width: 100vw;
        position: absolute;
        inset: 0;
        z-index: 50;
        display: flex;
      }

      .zalo-sidebar.hide-mobile {
        display: none;
      }

      .btn-back-sidebar {
        display: inline-flex;
      }

      .message-row {
        max-width: 88%;
      }
    }
  </style>
</head>
<body>

  <div class="zalo-layout-wrapper">
    <!-- =====================================================================
         1. SIDEBAR DANH SÁCH CHAT (THREADS LIST)
         ===================================================================== -->
    <aside class="zalo-sidebar" id="zaloSidebar">
      <div class="sidebar-header">
        <div class="sidebar-title-row">
          <div class="sidebar-brand">
            <div class="sidebar-brand-icon">💬</div>
            <span>Đoạn chat</span>
          </div>
          <button class="btn-new-thread" id="btnOpenNewThreadModal" title="Nhập Thread ID mới">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>

        <!-- Search Bar -->
        <div class="sidebar-search-box">
          <span class="search-icon-left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
          <input 
            type="text" 
            class="sidebar-search-input" 
            id="sidebarSearchInput" 
            placeholder="Tìm kiếm theo tên, SĐT, Cty..." 
            autocomplete="off"
          />
          <button class="search-clear-btn" id="searchClearBtn" title="Xóa">✕</button>
        </div>

        <!-- Filter Pills -->
        <div class="sidebar-filter-tabs">
          <button class="filter-tab-btn active" data-filter="all">Tất cả</button>
          <button class="filter-tab-btn" data-filter="personal">Cá nhân</button>
          <button class="filter-tab-btn" data-filter="group">Nhóm</button>
          <button class="filter-tab-btn" data-filter="manual">Thủ công (-M)</button>
        </div>
      </div>

      <!-- Threads Container with Infinite Scroll -->
      <div class="sidebar-threads-container" id="sidebarThreadsContainer">
        <!-- Thread items will be rendered here dynamically -->
      </div>
    </aside>

    <!-- =====================================================================
         2. KHUNG TRÒ CHUYỆN CHI TIẾT (MAIN CHAT AREA)
         ===================================================================== -->
    <main class="zalo-main-chat" id="zaloMainChat">
      <!-- 2.1. Welcome Empty View (khi chưa chọn thread) -->
      <div class="zalo-welcome-view" id="welcomeView" style="${initialThreadId ? 'display: none;' : 'display: flex;'}">
        <div class="welcome-illustration">💬</div>
        <h2 class="welcome-title">Chào mừng đến với Zalo AI</h2>
        <p class="welcome-desc">
          Hệ thống Trợ lý Tuyển dụng & Quản trị Tin nhắn Trực tiếp. Hãy chọn một cuộc trò chuyện từ danh sách bên trái để bắt đầu nhắn tin.
        </p>
        <button class="welcome-quick-btn" id="btnWelcomeNew">
          <span>➕ Nhập Thread ID thủ công</span>
        </button>
      </div>

      <!-- 2.2. Active Chat Detail View -->
      <div class="zalo-chat-view" id="activeChatView" style="${initialThreadId ? 'display: flex;' : 'display: none;'}">
        <!-- Header App Bar -->
        <header class="zalo-header">
          <div class="header-left">
            <button class="btn-back-sidebar" id="btnBackSidebar" title="Quay lại danh sách">
              ←
            </button>
            <div class="header-avatar" id="threadAvatar">
              <span id="avatarLetter">Z</span>
              <div class="thread-online-dot"></div>
            </div>
            <div class="header-info">
              <div class="header-title-row">
                <span class="header-name" id="threadName" title="Bấm để đổi tên">Đang tải...</span>
                <button class="btn-quick-rename" id="btnRename" title="Đổi tên gợi nhớ / Đổi tên nhóm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <span class="badge-candidate" id="candidateBadge" style="display:none;">Ứng viên</span>
              </div>
              <div class="header-sub">
                <span id="threadSubInfo">${initialThreadId || "---"}</span>
                <span id="candidateDetails" style="color: #059669; font-weight: 600;"></span>
              </div>
            </div>
          </div>

          <!-- Header Right: Switch Toggle giữa AI & Thủ công (Manual) -->
          <div class="header-right">
            <button class="mode-switch-btn is-ai" id="btnToggleMode" title="Bấm để chuyển đổi giữa Chế độ AI Tự động và Thủ công (Manual)">
              <span class="mode-pulse-dot"></span>
              <span id="modeIcon">🤖</span>
              <span id="modeText">AI Tự động</span>
            </button>
          </div>
        </header>

        <!-- Chat Timeline Container (với Scroll-to-Top Lazy Load) -->
        <div class="zalo-chat-container" id="chatContainer">
          <div class="older-messages-loader" id="olderMessagesLoader" style="display: none;">
            <button class="btn-load-older" id="btnLoadOlder">
              <span>⬆️ Tải thêm tin nhắn cũ</span>
            </button>
          </div>
          <div class="timeline-date-sep">
            <span class="timeline-date-pill" id="todayPill">Hôm nay</span>
          </div>
        </div>

        <!-- AI Active Banner (khi ở chế độ AI) -->
        <div class="ai-active-banner" id="aiActiveBanner" style="display: none;">
          <div class="ai-banner-left">
            <div class="ai-banner-icon-box">🤖</div>
            <div>
              <div class="ai-banner-title">Chế độ AI Tự động đang phản hồi</div>
              <div class="ai-banner-sub">Hệ thống đang tự động tư vấn ứng viên. Chuyển sang Thủ công để trực tiếp nhắn tin.</div>
            </div>
          </div>
          <button class="btn-activate-manual" id="btnActivateManual" type="button">
            <span>👤 Chuyển sang Thủ công</span>
          </button>
        </div>

        <!-- Toolbar & Input Area -->
        <footer class="zalo-input-wrapper" id="inputWrapper">
          <div class="zalo-toolbar">
            <button class="tool-btn-photo" id="btnPhoto" title="Chọn ảnh để gửi ngay lập tức">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
          </div>

          <input type="file" id="imageFileInput" accept="image/*" multiple style="display: none;">

          <div class="input-main-row">
            <textarea 
              class="zalo-textarea" 
              id="messageInput" 
              rows="1" 
              placeholder="Nhập tin nhắn..."
            ></textarea>
            
            <button class="send-action-btn" id="btnSend">
              <span>Gửi</span>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
        </footer>
      </div>
    </main>
  </div>

  <!-- MODAL NHẬP THREAD ID THỦ CÔNG -->
  <div class="thread-modal-backdrop" id="threadModal" style="display: none;">
    <div class="thread-modal-box">
      <div class="thread-modal-title">💬 Mở cuộc trò chuyện mới</div>
      <div class="thread-modal-sub">Vui lòng nhập User ID hoặc Group ID Zalo để vào khung chat.</div>
      <form id="threadModalForm">
        <input 
          type="text" 
          class="thread-modal-input" 
          id="threadModalInput" 
          placeholder="Ví dụ: 8289935740050353992 hoặc 7022361798516490807" 
          required 
        />
        <div class="thread-modal-actions">
          <button type="button" class="btn-modal-cancel" id="btnCancelThreadModal">Hủy</button>
          <button type="submit" class="thread-modal-submit-btn">Vào trò chuyện</button>
        </div>
      </form>
    </div>
  </div>

  <!-- LIGHTBOX ZOOM MODAL -->
  <div class="lightbox-modal" id="lightboxModal">
    <button class="lightbox-close-btn" id="lightboxClose">✕</button>
    <img class="lightbox-img" id="lightboxImg" src="" alt="Full view">
  </div>

  <!-- MODAL ĐỔI TÊN NHANH (CHUẨN ZALO) -->
  <div class="rename-modal-backdrop" id="renameModal" style="display: none;">
    <div class="rename-modal-box">
      <div class="rename-modal-title" id="renameModalTitle">Đổi tên gợi nhớ</div>
      <div class="rename-modal-sub" id="renameModalSub">
        Đặt tên gợi nhớ giúp bạn dễ dàng nhận diện và phân loại liên hệ này.
      </div>
      <form id="renameForm">
        <input 
          type="text" 
          class="rename-input" 
          id="renameInput" 
          placeholder="Nhập tên mới..." 
          maxlength="50" 
          autocomplete="off"
          required
        />
        <div class="rename-modal-actions">
          <button type="button" class="btn-rename-cancel" id="btnRenameCancel">Hủy</button>
          <button type="submit" class="btn-rename-save" id="btnRenameSave">Lưu</button>
        </div>
      </form>
    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <div class="zalo-toast" id="zaloToast"></div>

  <!-- =========================================================================
       CLIENT-SIDE SCRIPT: LAZY LOAD THREADS + LAZY LOAD MESSAGES + REALTIME SSE
       ========================================================================= -->
  <script>
    (function() {
      let currentThreadId = "${initialThreadId}";
      let currentOwnId = "${initialOwnId}";
      let currentFilter = "all";
      let currentSearch = "";

      // Threads pagination state
      let threadsOffset = 0;
      const threadsLimit = 20;
      let threadsHasMore = false;
      let isFetchingThreads = false;
      let threadsCache = new Map(); // threadId -> threadObject
      let threadsObserver = null;

      // Messages pagination state
      let oldestMessageTimestamp = 0;
      let hasMoreOlderMessages = false;
      let isFetchingOlderMessages = false;
      const renderedMessageIds = new Set();

      let isCurrentGroup = false;
      let isManualMode = false;
      let sseEventSource = null;

      // DOM Elements
      const zaloSidebar = document.getElementById("zaloSidebar");
      const sidebarThreadsContainer = document.getElementById("sidebarThreadsContainer");
      const sidebarSearchInput = document.getElementById("sidebarSearchInput");
      const searchClearBtn = document.getElementById("searchClearBtn");
      const filterTabBtns = document.querySelectorAll(".filter-tab-btn");
      const btnOpenNewThreadModal = document.getElementById("btnOpenNewThreadModal");
      const btnWelcomeNew = document.getElementById("btnWelcomeNew");

      const welcomeView = document.getElementById("welcomeView");
      const activeChatView = document.getElementById("activeChatView");
      const btnBackSidebar = document.getElementById("btnBackSidebar");

      const chatContainer = document.getElementById("chatContainer");
      const olderMessagesLoader = document.getElementById("olderMessagesLoader");
      const btnLoadOlder = document.getElementById("btnLoadOlder");

      const threadNameEl = document.getElementById("threadName");
      const threadSubInfoEl = document.getElementById("threadSubInfo");
      const avatarLetterEl = document.getElementById("avatarLetter");
      const threadAvatarEl = document.getElementById("threadAvatar");
      const candidateBadge = document.getElementById("candidateBadge");
      const candidateDetails = document.getElementById("candidateDetails");

      const btnToggleMode = document.getElementById("btnToggleMode");
      const modeIcon = document.getElementById("modeIcon");
      const modeText = document.getElementById("modeText");
      const aiActiveBanner = document.getElementById("aiActiveBanner");
      const btnActivateManual = document.getElementById("btnActivateManual");
      const inputWrapper = document.getElementById("inputWrapper");

      const messageInput = document.getElementById("messageInput");
      const btnSend = document.getElementById("btnSend");
      const btnPhoto = document.getElementById("btnPhoto");
      const imageFileInput = document.getElementById("imageFileInput");

      const threadModal = document.getElementById("threadModal");
      const threadModalForm = document.getElementById("threadModalForm");
      const threadModalInput = document.getElementById("threadModalInput");
      const btnCancelThreadModal = document.getElementById("btnCancelThreadModal");

      const renameModal = document.getElementById("renameModal");
      const renameForm = document.getElementById("renameForm");
      const renameInput = document.getElementById("renameInput");
      const btnRename = document.getElementById("btnRename");
      const btnRenameCancel = document.getElementById("btnRenameCancel");
      const btnRenameSave = document.getElementById("btnRenameSave");
      const zaloToast = document.getElementById("zaloToast");

      const lightboxModal = document.getElementById("lightboxModal");
      const lightboxImg = document.getElementById("lightboxImg");
      const lightboxClose = document.getElementById("lightboxClose");

      // =========================================================================
      // 1. HELPERS & FORMATTERS
      // =========================================================================
      function escapeHtml(text) {
        if (!text) return "";
        return String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function formatTime(timestamp) {
        if (!timestamp) return "";
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return "";
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) {
          return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        }
        return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
      }

      function showToast(text, type = "success") {
        if (!zaloToast) return;
        zaloToast.className = "zalo-toast " + type;
        zaloToast.textContent = text;
        zaloToast.classList.add("show");
        setTimeout(() => {
          zaloToast.classList.remove("show");
        }, 3000);
      }

      function sanitizeContent(text) {
        if (!text) return "";
        const trimmed = text.trim();
        const dummyStrings = ["[Hình ảnh]", "[Người dùng gửi một hình ảnh]", "[Hình ảnh đính kèm]", "[Ảnh]", "[Image]"];
        if (dummyStrings.includes(trimmed)) return "";
        return trimmed;
      }

      function openLightbox(src) {
        lightboxImg.src = src;
        lightboxModal.classList.add("active");
      }

      lightboxClose.addEventListener("click", () => lightboxModal.classList.remove("active"));
      lightboxModal.addEventListener("click", (e) => {
        if (e.target === lightboxModal) lightboxModal.classList.remove("active");
      });

      // =========================================================================
      // 2. SIDEBAR THREADS LIST (LAZY LOAD / INFINITE SCROLL)
      // =========================================================================
      async function fetchThreads(isReset = false) {
        if (isFetchingThreads) return;
        if (!isReset && !threadsHasMore) return;

        isFetchingThreads = true;
        if (isReset) {
          threadsOffset = 0;
          threadsHasMore = false;
          threadsCache.clear();
          sidebarThreadsContainer.innerHTML = '<div class="threads-loader-sentinel"><div class="threads-spinner-sm"></div> Đang tải danh sách...</div>';
        } else {
          updateSentinelLoadingState(true);
        }

        try {
          const params = new URLSearchParams({
            limit: String(threadsLimit),
            offset: String(threadsOffset),
            filter: currentFilter,
          });
          if (currentSearch) params.set("search", currentSearch);

          const res = await fetch("/api/chat/threads?" + params.toString());
          const data = await res.json();

          if (data.success && Array.isArray(data.threads)) {
            data.threads.forEach(t => {
              threadsCache.set(t.threadId, t);
            });

            threadsHasMore = Boolean(data.hasMore);
            threadsOffset = data.nextOffset || (threadsOffset + data.threads.length);
            renderSidebarThreads();

            // Nếu người dùng vào /chat mà chưa có threadId, tự động mở thread đầu tiên trên Desktop
            if (!currentThreadId && threadsCache.size > 0 && window.innerWidth > 768) {
              const firstThreadId = threadsCache.keys().next().value;
              if (firstThreadId) {
                switchThread(firstThreadId);
              }
            }

            // Nếu còn dữ liệu tiếp theo mà nội dung chưa lấp đầy chiều cao sidebar -> tải tiếp
            if (threadsHasMore && sidebarThreadsContainer.scrollHeight <= sidebarThreadsContainer.clientHeight + 50) {
              setTimeout(() => fetchThreads(false), 150);
            }
          } else {
            threadsHasMore = false;
            if (isReset) {
              sidebarThreadsContainer.innerHTML = '<div class="empty-threads-state"><span>🔍 Không có cuộc trò chuyện nào.</span></div>';
            } else {
              renderSidebarThreads();
            }
          }
        } catch (err) {
          console.error("Lỗi khi nạp danh sách cuộc trò chuyện:", err);
          threadsHasMore = false;
          if (isReset) {
            sidebarThreadsContainer.innerHTML = '<div class="empty-threads-state">⚠️ Lỗi kết nối máy chủ. Vui lòng tải lại trang.</div>';
          } else {
            renderSidebarThreads();
          }
        } finally {
          isFetchingThreads = false;
          updateSentinelLoadingState(false);
        }
      }

      function updateSentinelLoadingState(isLoading) {
        const sentinel = document.getElementById("threadsSentinel");
        if (!sentinel) return;
        if (isLoading) {
          sentinel.style.display = "flex";
          sentinel.innerHTML = '<div class="threads-spinner-sm"></div> Đang cuộn tải thêm...';
        } else {
          if (!threadsHasMore) {
            sentinel.style.display = "none";
          } else {
            sentinel.style.display = "flex";
            sentinel.innerHTML = '';
          }
        }
      }

      function renderSidebarThreads() {
        const allThreads = Array.from(threadsCache.values());

        sidebarThreadsContainer.innerHTML = "";

        if (allThreads.length === 0) {
          if (!threadsHasMore) {
            sidebarThreadsContainer.innerHTML = '<div class="empty-threads-state"><span>🔍 Không có cuộc trò chuyện nào phù hợp.</span></div>';
          } else {
            sidebarThreadsContainer.innerHTML = '<div class="threads-loader-sentinel"><div class="threads-spinner-sm"></div> Đang tìm tiếp...</div>';
          }
          return;
        }

        // Xây dựng DOM danh sách thread
        allThreads.forEach(t => {
          const itemEl = createThreadItemElement(t);
          sidebarThreadsContainer.appendChild(itemEl);
        });

        // Thêm Sentinel Loader ở đáy nếu còn dữ liệu để cuộn tiếp
        if (threadsHasMore) {
          const sentinel = document.createElement("div");
          sentinel.className = "threads-loader-sentinel";
          sentinel.id = "threadsSentinel";
          sentinel.style.minHeight = "20px";
          sentinel.style.display = isFetchingThreads ? "flex" : "none";
          if (isFetchingThreads) {
            sentinel.innerHTML = '<div class="threads-spinner-sm"></div> Đang cuộn tải thêm...';
          }
          sidebarThreadsContainer.appendChild(sentinel);
          setupSentinelObserver(sentinel);
        }
      }

      function setupSentinelObserver(sentinelEl) {
        if (!window.IntersectionObserver || !sentinelEl) return;
        if (threadsObserver) {
          threadsObserver.disconnect();
        }
        threadsObserver = new IntersectionObserver((entries) => {
          if (entries[0] && entries[0].isIntersecting && threadsHasMore && !isFetchingThreads) {
            fetchThreads(false);
          }
        }, {
          root: sidebarThreadsContainer,
          rootMargin: "80px",
        });
        threadsObserver.observe(sentinelEl);
      }

      function createThreadItemElement(t) {
        const div = document.createElement("div");
        div.className = "thread-item" + (t.threadId === currentThreadId ? " active" : "");
        div.dataset.threadId = t.threadId;

        const avatarClass = t.isGroup ? "thread-item-avatar is-group" : "thread-item-avatar";
        const isSelfLast = t.lastRole === "model";
        const previewPrefix = isSelfLast ? "Bạn: " : "";
        const rawPreviewText = t.lastHasImage ? "🖼️ [Hình ảnh]" : (t.lastContent || "Bắt đầu cuộc trò chuyện");
        const safeName = escapeHtml(t.threadName || t.threadId);
        const safePreview = escapeHtml(previewPrefix + rawPreviewText);
        const safeCompany = t.targetCompany ? escapeHtml(t.targetCompany) : "";

        div.innerHTML = \`
          <div class="\${avatarClass}">
            <span>\${escapeHtml(t.avatarLetter || "Z")}</span>
            <div class="thread-online-dot"></div>
          </div>
          <div class="thread-item-body">
            <div class="thread-item-row1">
              <span class="thread-item-name">\${safeName}</span>
              <span class="thread-item-time">\${formatTime(t.lastTimestamp)}</span>
            </div>
            <div class="thread-item-row2">
              <span class="thread-item-preview \${isSelfLast ? 'is-self' : ''}">\${safePreview}</span>
              <div class="thread-badge-group">
                \${safeCompany ? '<span class="thread-badge-candidate">' + safeCompany + '</span>' : ''}
                \${t.isManual ? '<span class="thread-badge-manual">-M</span>' : ''}
              </div>
            </div>
          </div>
        \`;

        div.addEventListener("click", () => {
          switchThread(t.threadId);
        });

        return div;
      }

      function updateThreadItemElement(el, t) {
        if (t.threadId === currentThreadId) {
          el.classList.add("active");
        } else {
          el.classList.remove("active");
        }

        const nameEl = el.querySelector(".thread-item-name");
        if (nameEl) nameEl.textContent = t.threadName || t.threadId;

        const timeEl = el.querySelector(".thread-item-time");
        if (timeEl) timeEl.textContent = formatTime(t.lastTimestamp);

        const previewEl = el.querySelector(".thread-item-preview");
        if (previewEl) {
          const isSelfLast = t.lastRole === "model";
          const previewPrefix = isSelfLast ? "Bạn: " : "";
          const previewText = t.lastHasImage ? "🖼️ [Hình ảnh]" : (t.lastContent || "Đoạn chat");
          previewEl.textContent = previewPrefix + previewText;
          if (isSelfLast) previewEl.classList.add("is-self");
          else previewEl.classList.remove("is-self");
        }
      }

      // Infinite scroll listener trên Sidebar
      sidebarThreadsContainer.addEventListener("scroll", function() {
        if (!threadsHasMore || isFetchingThreads) return;
        const scrollBottom = sidebarThreadsContainer.scrollHeight - sidebarThreadsContainer.scrollTop - sidebarThreadsContainer.clientHeight;
        if (scrollBottom < 80) {
          fetchThreads(false);
        }
      });

      // Search debounce
      let searchTimeout = null;
      sidebarSearchInput.addEventListener("input", function() {
        const val = this.value.trim();
        searchClearBtn.style.display = val ? "flex" : "none";
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          currentSearch = val;
          fetchThreads(true);
        }, 280);
      });

      searchClearBtn.addEventListener("click", function() {
        sidebarSearchInput.value = "";
        searchClearBtn.style.display = "none";
        currentSearch = "";
        fetchThreads(true);
        sidebarSearchInput.focus();
      });

      // Filter tabs
      filterTabBtns.forEach(btn => {
        btn.addEventListener("click", function() {
          if (this.classList.contains("active")) return;
          filterTabBtns.forEach(b => b.classList.remove("active"));
          this.classList.add("active");
          currentFilter = this.dataset.filter || "all";
          fetchThreads(true); // Reset và gọi API nạp trực tiếp danh sách của tab đó từ Backend!
        });
      });

      // =========================================================================
      // 3. CHUYỂN ĐỔI THREAD & NẠP TIN NHẮN (LAZY LOAD SCROLL TO TOP)
      // =========================================================================
      function switchThread(newThreadId) {
        if (!newThreadId) return;
        currentThreadId = newThreadId;

        // Cập nhật active sidebar
        document.querySelectorAll(".thread-item").forEach(item => {
          if (item.dataset.threadId === currentThreadId) item.classList.add("active");
          else item.classList.remove("active");
        });

        // Đổi view
        welcomeView.style.display = "none";
        activeChatView.style.display = "flex";

        // Cập nhật URL trình duyệt mà không reload
        window.history.pushState({}, "", "/chat?thread=" + encodeURIComponent(currentThreadId));

        // Ẩn sidebar trên mobile khi đã chọn chat
        zaloSidebar.classList.add("hide-mobile");

        // Tải lịch sử tin nhắn của thread mới
        renderedMessageIds.clear();
        chatContainer.querySelectorAll(".message-row").forEach(el => el.remove());
        oldestMessageTimestamp = 0;
        hasMoreOlderMessages = false;
        olderMessagesLoader.style.display = "none";

        loadHistoryInitial();
        setupRealtimeSSE();
      }

      btnBackSidebar.addEventListener("click", () => {
        zaloSidebar.classList.remove("hide-mobile");
      });

      // Tạo một bubble tin nhắn
      function createMessageElement(msg, isOptimistic = false) {
        const cleanText = sanitizeContent(msg.content);
        const hasValidImages = Boolean(msg.hasImage && msg.imageUrls && Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0);

        if (!cleanText && !hasValidImages) return null;

        const isSelf = msg.role === "model" || (currentOwnId && msg.senderId === currentOwnId) || msg.senderId === "admin";
        const row = document.createElement("div");
        row.className = "message-row " + (isSelf ? "outgoing" : "incoming");
        if (isOptimistic) row.classList.add("temp-pending");
        if (msg.id) row.dataset.id = msg.id;
        row.dataset.content = cleanText;

        // Avatar cho incoming
        if (!isSelf) {
          const avatar = document.createElement("div");
          avatar.className = "msg-avatar";
          avatar.textContent = (msg.senderName || "U").trim().charAt(0).toUpperCase();
          row.appendChild(avatar);
        }

        const bodyWrapper = document.createElement("div");
        bodyWrapper.className = "msg-body-wrapper";

        if (!isSelf && msg.senderName && isCurrentGroup) {
          const senderNameEl = document.createElement("span");
          senderNameEl.className = "msg-sender-name";
          senderNameEl.textContent = msg.senderName;
          bodyWrapper.appendChild(senderNameEl);
        }

        // Khung trích dẫn / Reply nếu có
        let quoteCardEl = null;
        if (msg.hasQuote && msg.quoteText) {
          quoteCardEl = document.createElement("div");
          quoteCardEl.className = "msg-quote-card";
          const qSender = escapeHtml(msg.quoteSenderName || ((currentOwnId && msg.quoteSenderId === currentOwnId) ? "Admin (Tôi)" : "Tin nhắn trước"));
          const qText = escapeHtml(msg.quoteText);
          quoteCardEl.innerHTML = \`
            <span class="quote-sender">↪️ \${qSender}</span>
            <span class="quote-text">\${qText}</span>
          \`;
        }

        // Ảnh
        if (hasValidImages && !cleanText) {
          if (quoteCardEl) {
            bodyWrapper.appendChild(quoteCardEl);
          }

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
            img.addEventListener("click", () => openLightbox(url));

            img.onerror = function() {
              container.style.display = "none";
            };

            container.appendChild(img);

            if (isOptimistic) {
              const progressOverlay = document.createElement("div");
              progressOverlay.className = "upload-progress-overlay";
              progressOverlay.innerHTML = \`
                <div class="progress-spinner"></div>
                <div class="progress-text">Đang gửi...</div>
              \`;
              container.appendChild(progressOverlay);
            }

            imagesContainer.appendChild(container);
          });

          bodyWrapper.appendChild(imagesContainer);
        } else {
          const bubble = document.createElement("div");
          bubble.className = "msg-bubble";

          if (quoteCardEl) {
            bubble.appendChild(quoteCardEl);
          }

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
              img.addEventListener("click", () => openLightbox(url));
              container.appendChild(img);
              imagesContainer.appendChild(container);
            });

            bubble.appendChild(imagesContainer);
          }

          bodyWrapper.appendChild(bubble);
        }

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

      // Nạp tin nhắn ban đầu (30 tin gần nhất)
      async function loadHistoryInitial() {
        if (!currentThreadId) return;

        try {
          const res = await fetch("/api/chat/history?thread=" + encodeURIComponent(currentThreadId) + "&limit=30");
          const data = await res.json();

          if (data.threadName) {
            const isManual = data.isManual !== undefined ? Boolean(data.isManual) : /^-M(\s|_|-|$)/i.test(data.threadName);
            const displayName = isManual && !/^-M(\s|_|-|$)/i.test(data.threadName) ? "-M " + data.threadName : data.threadName;

            threadNameEl.textContent = displayName;
            messageInput.placeholder = "Nhập tin nhắn tới " + displayName + "...";
            avatarLetterEl.textContent = displayName.trim().charAt(0).toUpperCase();
            document.title = displayName + " - Trò Chuyện Trực Tiếp";

            setMode(isManual, false);
          }

          isCurrentGroup = Boolean(data.isGroup);
          if (isCurrentGroup) threadAvatarEl.classList.add("is-group");
          else threadAvatarEl.classList.remove("is-group");

          threadSubInfoEl.textContent = currentThreadId;

          if (data.candidate) {
            candidateBadge.style.display = "inline-flex";
            const c = data.candidate;
            candidateDetails.textContent = "• Ứng viên: " + (c.fullName || c.senderName) + " (SĐT: " + (c.phoneNumber || "Chưa có") + " | " + (c.targetCompany || "Chưa có cty") + ")";
          } else {
            candidateBadge.style.display = "none";
            candidateDetails.textContent = "";
          }

          hasMoreOlderMessages = Boolean(data.hasMoreOlder);
          olderMessagesLoader.style.display = hasMoreOlderMessages ? "flex" : "none";

          const list = data.messages || [];
          if (Array.isArray(list) && list.length > 0) {
            oldestMessageTimestamp = list[0].timestamp || 0;
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

      // Lazy load tin cũ khi cuộn lên đỉnh (Scroll-to-Top Infinite Scroll)
      async function loadOlderMessages() {
        if (!currentThreadId || !hasMoreOlderMessages || isFetchingOlderMessages || !oldestMessageTimestamp) return;

        isFetchingOlderMessages = true;
        btnLoadOlder.textContent = "Đang nạp tin cũ...";

        const previousScrollHeight = chatContainer.scrollHeight;
        const previousScrollTop = chatContainer.scrollTop;

        try {
          const res = await fetch(\`/api/chat/history?thread=\${encodeURIComponent(currentThreadId)}&before=\${oldestMessageTimestamp}&limit=30\`);
          const data = await res.json();

          const olderList = data.messages || [];
          hasMoreOlderMessages = Boolean(data.hasMoreOlder);
          olderMessagesLoader.style.display = hasMoreOlderMessages ? "flex" : "none";

          if (Array.isArray(olderList) && olderList.length > 0) {
            oldestMessageTimestamp = olderList[0].timestamp || oldestMessageTimestamp;

            // Chèn tin cũ vào ngay sau olderMessagesLoader mà không làm giật vị trí cuộn
            const fragment = document.createDocumentFragment();
            olderList.forEach(msg => {
              if (msg.id && renderedMessageIds.has(msg.id)) return;
              if (msg.id) renderedMessageIds.add(msg.id);
              const el = createMessageElement(msg);
              if (el) fragment.appendChild(el);
            }); 

            olderMessagesLoader.after(fragment);

            // Bảo lưu vị trí cuộn
            const newScrollHeight = chatContainer.scrollHeight;
            chatContainer.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
          }
        } catch (err) {
          console.error("Lỗi tải tin nhắn cũ:", err);
        } finally {
          isFetchingOlderMessages = false;
          btnLoadOlder.textContent = "⬆️ Tải thêm tin nhắn cũ";
        }
      }

      btnLoadOlder.addEventListener("click", loadOlderMessages);

      // Tự động tải tin cũ khi cuộn lên gần đỉnh (scrollTop < 30)
      chatContainer.addEventListener("scroll", function() {
        if (chatContainer.scrollTop < 30 && hasMoreOlderMessages && !isFetchingOlderMessages) {
          loadOlderMessages();
        }
      });

      // =========================================================================
      // 4. QUẢN LÝ CHẾ ĐỘ AI / THỦ CÔNG (-M)
      // =========================================================================
      function setMode(isManual, showNotice = false) {
        isManualMode = isManual;

        if (isManual) {
          if (btnToggleMode) btnToggleMode.className = "mode-switch-btn is-manual";
          if (modeIcon) modeIcon.textContent = "👤";
          if (modeText) modeText.textContent = "Thủ công (-M)";
          if (inputWrapper) inputWrapper.style.display = "flex";
          if (aiActiveBanner) aiActiveBanner.style.display = "none";
          if (showNotice) showToast("👤 Đã chuyển sang Thủ công (-M)", "success");
        } else {
          if (btnToggleMode) btnToggleMode.className = "mode-switch-btn is-ai";
          if (modeIcon) modeIcon.textContent = "🤖";
          if (modeText) modeText.textContent = "AI Tự động";
          if (inputWrapper) inputWrapper.style.display = "none";
          if (aiActiveBanner) aiActiveBanner.style.display = "flex";
          if (showNotice) showToast("🤖 Đã bật AI Tự động", "success");
        }
      }

      async function toggleAIMode(targetMode) {
        if (!currentThreadId) return;
        if (btnToggleMode) btnToggleMode.disabled = true;

        try {
          const res = await fetch("/api/chat/toggle-mode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: currentThreadId,
              targetMode: targetMode || (isManualMode ? "ai" : "manual"),
              isGroup: isCurrentGroup,
            }),
          });
          const data = await res.json();
          if (data.success) {
            const isManual = data.mode === "manual";
            setMode(isManual, true);
            if (data.newName) {
              threadNameEl.textContent = data.newName;
              messageInput.placeholder = "Nhập tin nhắn tới " + data.newName + "...";
              avatarLetterEl.textContent = data.newName.trim().charAt(0).toUpperCase();

              // Cập nhật cache sidebar
              const cached = threadsCache.get(currentThreadId);
              if (cached) {
                cached.threadName = data.newName;
                cached.isManual = isManual;
                renderSidebarThreads();
              }
            }
          }
        } catch (err) {
          console.error("Lỗi toggle mode:", err);
        } finally {
          if (btnToggleMode) btnToggleMode.disabled = false;
        }
      }

      btnToggleMode.addEventListener("click", () => toggleAIMode());
      btnActivateManual.addEventListener("click", () => toggleAIMode("manual"));

      // =========================================================================
      // 5. GỬI TIN NHẮN & ẢNH
      // =========================================================================
      messageInput.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });

      async function handleSendMessage() {
        const text = messageInput.value.trim();
        if (!text || !currentThreadId) return;

        btnSend.disabled = true;

        const tempId = "temp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const tempMsg = {
          id: tempId,
          role: "model",
          senderId: currentOwnId || "admin",
          senderName: "Admin (Tôi)",
          content: text,
          timestamp: Date.now(),
        };

        const tempEl = createMessageElement(tempMsg, true);
        if (tempEl) {
          tempEl.dataset.tempId = tempId;
          tempEl.dataset.msgContent = text;
          chatContainer.appendChild(tempEl);
          scrollToBottom();
        }

        messageInput.value = "";
        messageInput.style.height = "auto";

        try {
          await fetch("/api/chat/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: currentThreadId,
              message: text,
            }),
          });
        } catch (err) {
          console.error("Lỗi gửi tin nhắn:", err);
        } finally {
          btnSend.disabled = false;
        }
      }

      btnSend.addEventListener("click", handleSendMessage);
      messageInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });

      // Upload ảnh
      btnPhoto.addEventListener("click", () => imageFileInput.click());
      imageFileInput.addEventListener("change", function() {
        const files = Array.from(this.files || []);
        if (files.length === 0 || !currentThreadId) return;
        this.value = "";

        files.forEach(file => {
          const reader = new FileReader();
          reader.onload = async function(e) {
            const dataUrl = e.target.result;
            const tempId = "temp_img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
            const tempMsg = {
              id: tempId,
              role: "model",
              senderId: currentOwnId || "admin",
              senderName: "Admin (Tôi)",
              content: "",
              hasImage: true,
              imageUrls: [dataUrl],
              timestamp: Date.now(),
            };
            const tempEl = createMessageElement(tempMsg, true);
            if (tempEl) {
              tempEl.dataset.tempId = tempId;
              tempEl.dataset.isTempImage = "true";
              chatContainer.appendChild(tempEl);
              scrollToBottom();
            }

            try {
              await fetch("/api/chat/send-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  threadId: currentThreadId,
                  imageBase64: dataUrl,
                  filename: file.name || "image.png",
                }),
              });
            } catch (err) {
              console.error("Lỗi gửi ảnh:", err);
            }
          };
          reader.readAsDataURL(file);
        });
      });

      // =========================================================================
      // 6. REALTIME SSE (ĐỒNG BỘ TIN NHẮN & CẬP NHẬT SIDEBAR ĐƯA LÊN ĐẦU)
      // =========================================================================
      function setupRealtimeSSE() {
        if (sseEventSource) sseEventSource.close();
        sseEventSource = new EventSource("/api/chat/events?thread=" + encodeURIComponent(currentThreadId));

        sseEventSource.onmessage = function(event) {
          try {
            const newMsg = JSON.parse(event.data);
            if (!newMsg) return;

            // Đổi tên
            if (newMsg.type === "thread_renamed" && newMsg.newName) {
              if (currentThreadId === newMsg.threadId) {
                threadNameEl.textContent = newMsg.newName;
              }
              const cached = threadsCache.get(newMsg.threadId);
              if (cached) {
                cached.threadName = newMsg.newName;
                renderSidebarThreads();
              }
              return;
            }

            // Cập nhật Sidebar: Đưa thread có tin nhắn mới lên đầu danh sách
            if (newMsg.threadId) {
              let t = threadsCache.get(newMsg.threadId);
              if (!t) {
                t = {
                  threadId: newMsg.threadId,
                  threadName: newMsg.senderName || newMsg.threadId,
                  avatarLetter: (newMsg.senderName || "U").trim().charAt(0).toUpperCase(),
                  isGroup: Boolean(newMsg.isGroup),
                  isManual: false,
                  lastContent: newMsg.content || "",
                  lastHasImage: Boolean(newMsg.hasImage),
                  lastTimestamp: newMsg.timestamp || Date.now(),
                  lastRole: newMsg.role || "user",
                };
              } else {
                t.lastContent = newMsg.content || "";
                t.lastHasImage = Boolean(newMsg.hasImage);
                t.lastTimestamp = newMsg.timestamp || Date.now();
                t.lastRole = newMsg.role || "user";
              }

              // Xóa và set lại để nhảy lên đầu Map
              threadsCache.delete(newMsg.threadId);
              const newMap = new Map();
              newMap.set(newMsg.threadId, t);
              threadsCache.forEach((v, k) => newMap.set(k, v));
              threadsCache = newMap;
              renderSidebarThreads();
            }

            // Nếu tin nhắn thuộc thread hiện tại -> hiển thị vào timeline
            if (newMsg.threadId === currentThreadId) {
              if (newMsg.id && renderedMessageIds.has(newMsg.id)) return;

              const cleanText = sanitizeContent(newMsg.content);
              const isSelf = newMsg.role === "model" || (currentOwnId && newMsg.senderId === currentOwnId) || newMsg.senderId === "admin";

              // Nếu là tin nhắn gửi đi của chính mình -> Khớp và xác nhận tin nhắn tạm (optimistic)
              if (isSelf) {
                const pendingEls = chatContainer.querySelectorAll(".message-row.temp-pending");
                let matchedPending = null;
                for (const pEl of pendingEls) {
                  if (newMsg.hasImage && pEl.dataset.isTempImage === "true") {
                    matchedPending = pEl;
                    break;
                  } else if (cleanText && pEl.dataset.msgContent === cleanText) {
                    matchedPending = pEl;
                    break;
                  }
                }

                if (matchedPending) {
                  matchedPending.classList.remove("temp-pending");
                  delete matchedPending.dataset.tempId;
                  delete matchedPending.dataset.isTempImage;
                  const overlay = matchedPending.querySelector(".upload-progress-overlay");
                  if (overlay) overlay.remove();
                  if (newMsg.id) {
                    matchedPending.dataset.id = newMsg.id;
                    renderedMessageIds.add(newMsg.id);
                  }
                  return; // Đã xác nhận tin nhắn tạm, dừng ngay để không tạo bong bóng duplicate!
                }
              }

              // Kiểm tra chống duplicate nếu tin nhắn cuối cùng trên UI giống hệt
              const allRows = chatContainer.querySelectorAll(".message-row:not(.temp-pending)");
              if (allRows.length > 0) {
                const lastRow = allRows[allRows.length - 1];
                if (
                  lastRow.dataset.content === cleanText &&
                  lastRow.classList.contains(isSelf ? "outgoing" : "incoming") &&
                  !newMsg.hasImage
                ) {
                  if (newMsg.id) renderedMessageIds.add(newMsg.id);
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
            console.error("Lỗi SSE:", err);
          }
        };
      }

      // =========================================================================
      // 7. MODALS (NEW THREAD, RENAME)
      // =========================================================================
      function openThreadModal() {
        threadModal.style.display = "flex";
        threadModalInput.value = "";
        setTimeout(() => threadModalInput.focus(), 50);
      }

      btnOpenNewThreadModal.addEventListener("click", openThreadModal);
      btnWelcomeNew.addEventListener("click", openThreadModal);
      btnCancelThreadModal.addEventListener("click", () => {
        threadModal.style.display = "none";
      });

      threadModalForm.addEventListener("submit", function(e) {
        e.preventDefault();
        const val = threadModalInput.value.trim();
        if (val) {
          threadModal.style.display = "none";
          switchThread(val);
        }
      });

      // Quick Rename
      btnRename.addEventListener("click", () => {
        if (!currentThreadId) return;
        renameInput.value = threadNameEl.textContent === "Đang tải..." ? "" : threadNameEl.textContent;
        renameModal.style.display = "flex";
        setTimeout(() => renameInput.focus(), 50);
      });

      btnRenameCancel.addEventListener("click", () => {
        renameModal.style.display = "none";
      });

      renameForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        const newName = renameInput.value.trim();
        if (!newName || !currentThreadId) return;

        btnRenameSave.disabled = true;
        try {
          const res = await fetch("/api/chat/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: currentThreadId,
              newName: newName,
              isGroup: isCurrentGroup,
            }),
          });
          const data = await res.json();
          if (data.success) {
            threadNameEl.textContent = newName;
            const cached = threadsCache.get(currentThreadId);
            if (cached) {
              cached.threadName = newName;
              renderSidebarThreads();
            }
            showToast("✓ Đã đổi tên thành công!");
            renameModal.style.display = "none";
          }
        } catch (err) {
          console.error("Lỗi đổi tên:", err);
        } finally {
          btnRenameSave.disabled = false;
        }
      });

      // =========================================================================
      // 8. KHỞI ĐỘNG BAN ĐẦU
      // =========================================================================
      fetchThreads(true);

      if (currentThreadId) {
        switchThread(currentThreadId);
      }
    })();
  </script>
</body>
</html>
  `;
}
