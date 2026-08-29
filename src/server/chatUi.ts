/**
 * renderChatPage: Render giao diện Web Chat chuẩn Zalo PC 2 cột (Sidebar Danh sách chat + Khung chat chi tiết)
 * Tách biệt HTML Shell, CSS (/static/chat.css) và JS (/static/chat.js) theo tiêu chuẩn SRP & Web Performance.
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
  <link rel="stylesheet" href="/static/chat.css?v=2">
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
    window.APP_CONFIG = {
      initialThreadId: "${initialThreadId}",
      initialOwnId: "${initialOwnId}"
    };
  </script>
  <script src="/static/chat.js?v=2"></script>
</body>
</html>
  `;
}
