import React from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

// Helper định dạng thời gian gọn gàng chuẩn Zalo PC
function formatZaloTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp));
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Vài giây';
  if (diffMin < 60) return `${diffMin} phút`;
  if (diffHour < 24) return `${diffHour} giờ`;
  if (diffDay < 7) return `${diffDay} ngày`;

  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

export function Sidebar({
  threads,
  activeThreadId,
  onSelectThread,
  searchQuery,
  onSearchChange,
  filterMode,
  onFilterChange,
  onOpenNewThreadModal,
  onLoadMoreThreads,
  hasMoreThreads,
  loadingThreads,
  hideOnMobile,
}) {
  return html`
    <!-- CỘT DANH SÁCH CUỘC TRÒ CHUYỆN (SIDEBAR) -->
    <aside className=${`zalo-sidebar ${hideOnMobile ? 'hide-mobile' : ''}`}>
      <div className="sidebar-header">
        <!-- Search row -->
        <div className="sidebar-search-row">
          <div className="sidebar-search-box">
            <span className="sidebar-search-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Tìm kiếm nhóm hoặc tin nhắn..."
              value=${searchQuery}
              onChange=${(e) => onSearchChange(e.target.value)}
            />
            ${searchQuery && html`
              <button
                className="sidebar-search-clear"
                onClick=${() => onSearchChange('')}
                title="Xóa tìm kiếm"
              >
                ✕
              </button>
            `}
          </div>

          <button
            className="btn-sidebar-tool"
            onClick=${onOpenNewThreadModal}
            title="Thêm cuộc trò chuyện mới"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <line x1="19" y1="8" x2="19" y2="14"></line>
              <line x1="22" y1="11" x2="16" y2="11"></line>
            </svg>
          </button>
        </div>

        <!-- Filter tabs chuẩn Zalo PC -->
        <div className="filter-tabs-row">
          <button
            className=${`filter-tab-pill ${filterMode === 'all' ? 'active' : ''}`}
            onClick=${() => onFilterChange('all')}
          >
            Tất cả
          </button>

          <button
            className=${`filter-tab-pill ${filterMode === 'direct' ? 'active' : ''}`}
            onClick=${() => onFilterChange('direct')}
          >
            Cá nhân
          </button>

          <button
            className=${`filter-tab-pill manual-tab ${filterMode === 'manual' ? 'active' : ''}`}
            onClick=${() => onFilterChange('manual')}
            title="Khách đang ở chế độ Thủ công (-M)"
          >
            Thủ công (-M)
          </button>

          <button
            className=${`filter-tab-pill ${filterMode === 'group' ? 'active' : ''}`}
            onClick=${() => onFilterChange('group')}
          >
            Nhóm
          </button>
        </div>
      </div>

      <!-- Threads Scroll List -->
      <div className="sidebar-threads-scroll">
        ${threads.length === 0 && !loadingThreads && html`
          <div style=${{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Không tìm thấy cuộc trò chuyện nào
          </div>
        `}

        ${threads.map((thread) => {
          const isActive = thread.threadId === activeThreadId;
          const isGroup = Boolean(thread.isGroup);
          const isManual = Boolean(thread.isManual);
          const displayName = thread.threadName || (isGroup ? `Nhóm ${thread.threadId}` : `Khách ${thread.threadId.slice(-4)}`);
          const avatarChar = (displayName || 'U').trim().charAt(0).toUpperCase();

          const snippet = thread.lastHasVoice
            ? '🎙️ [Tin nhắn thoại]'
            : thread.lastContent
            ? (thread.lastContent.startsWith('[🎙️ Tin nhắn thoại]:')
                ? '🎙️ ' + thread.lastContent.replace('[🎙️ Tin nhắn thoại]:', '').trim().replace(/^["\s]+|["\s]+$/g, '')
                : thread.lastContent)
            : thread.lastHasImage
            ? '[Hình ảnh]'
            : 'Chưa có tin nhắn';

          const isSelf = thread.lastRole === 'model';
          const timeLabel = formatZaloTime(thread.lastTimestamp);

          return html`
            <div
              key=${thread.threadId}
              className=${`thread-row-item ${isActive ? 'active' : ''}`}
              onClick=${() => onSelectThread(thread.threadId)}
            >
              <div className="thread-avatar-wrapper">
                <div className=${`thread-avatar-circle ${isGroup ? 'is-group' : ''} ${isManual ? 'is-manual-avatar' : ''}`}>
                  ${isGroup ? html`
                    <!-- Icon SVG Nhóm Tinh Tế Chuẩn Zalo PC -->
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                  ` : avatarChar}
                </div>
                ${!isGroup && html`<div className="thread-online-badge"></div>`}
              </div>

              <div className="thread-meta-info">
                <div className="thread-header-line">
                  <span className="thread-title-text" title=${displayName}>
                    ${displayName}
                  </span>
                  <span className="thread-time-label">${timeLabel}</span>
                </div>

                <div className="thread-snippet-line">
                  <span className=${`thread-snippet-text ${isSelf ? 'is-self' : ''}`} title=${snippet}>
                    ${isSelf ? 'Bạn: ' : ''}${snippet}
                  </span>

                  <div className="thread-tags-box">
                    ${isGroup && html`
                      <span className="tag-group-pill">Nhóm</span>
                    `}
                    ${isManual && html`
                      <span className="tag-manual">-M</span>
                    `}
                    ${thread.targetCompany && html`
                      <span className="tag-company" title=${thread.targetCompany}>
                        ${thread.targetCompany}
                      </span>
                    `}
                  </div>
                </div>
              </div>
            </div>
          `;
        })}

        ${hasMoreThreads && html`
          <div style=${{ padding: '10px', textAlign: 'center' }}>
            <button
              className="btn-load-older"
              onClick=${onLoadMoreThreads}
              disabled=${loadingThreads}
            >
              ${loadingThreads ? 'Đang tải thêm...' : 'Tải thêm'}
            </button>
          </div>
        `}
      </div>
    </aside>
  `;
}
