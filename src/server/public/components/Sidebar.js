import React, { useRef, useEffect } from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

function formatThreadTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(Number(timestamp));
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  if (isToday) return `${hours}:${minutes}`;
  return `${date.getDate()}/${date.getMonth() + 1}`;
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
  const scrollContainerRef = useRef(null);

  const handleScroll = () => {
    if (!scrollContainerRef.current || !hasMoreThreads || loadingThreads) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 60) {
      onLoadMoreThreads();
    }
  };

  return html`
    <aside className=${`zalo-sidebar ${hideOnMobile ? 'hide-mobile' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-top-row">
          <div className="sidebar-brand">
            <div className="sidebar-brand-badge">⚡</div>
            <div>
              <div className="sidebar-brand-title">Zalo AI Bot</div>
              <div className="sidebar-brand-subtitle">Executive Chat</div>
            </div>
          </div>

          <button
            className="btn-icon-action"
            title="Mở đoạn chat mới"
            onClick=${onOpenNewThreadModal}
          >
            ＋
          </button>
        </div>

        <div className="sidebar-search-box">
          <span className="sidebar-search-icon">🔍</span>
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Tìm kiếm ứng viên, tin nhắn..."
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

        <div className="filter-tabs-wrapper">
          <button
            className=${`filter-tab-btn ${filterMode === 'all' ? 'active' : ''}`}
            onClick=${() => onFilterChange('all')}
          >
            Tất cả
          </button>
          <button
            className=${`filter-tab-btn ${filterMode === 'personal' ? 'active' : ''}`}
            onClick=${() => onFilterChange('personal')}
          >
            Cá nhân
          </button>
          <button
            className=${`filter-tab-btn ${filterMode === 'group' ? 'active' : ''}`}
            onClick=${() => onFilterChange('group')}
          >
            Nhóm
          </button>
          <button
            className=${`filter-tab-btn manual-tab ${filterMode === 'manual' ? 'active' : ''}`}
            onClick=${() => onFilterChange('manual')}
          >
            Thủ công (-M)
          </button>
        </div>
      </div>

      <div
        className="sidebar-threads-scroll"
        ref=${scrollContainerRef}
        onScroll=${handleScroll}
      >
        ${threads.length === 0 && !loadingThreads && html`
          <div style=${{ padding: '30px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            Không tìm thấy cuộc trò chuyện nào
          </div>
        `}

        ${threads.map((thread) => {
          const isActive = thread.threadId === activeThreadId;
          const isSelf = thread.lastRole === 'model' || thread.lastRole === 'admin';
          const avatarLetter = (thread.threadName || 'U').trim().charAt(0).toUpperCase();

          return html`
            <div
              key=${thread.threadId}
              className=${`thread-card ${isActive ? 'active' : ''}`}
              onClick=${() => onSelectThread(thread.threadId)}
            >
              <div className="thread-avatar-box">
                <div className=${`thread-avatar ${thread.isGroup ? 'is-group' : ''}`}>
                  ${thread.isGroup ? '👥' : avatarLetter}
                </div>
                <div className="thread-online-dot"></div>
              </div>

              <div className="thread-info-content">
                <div className="thread-row-1">
                  <span className="thread-name" title=${thread.threadName}>
                    ${thread.threadName}
                  </span>
                  <span className="thread-time">
                    ${formatThreadTime(thread.lastTimestamp)}
                  </span>
                </div>

                <div className="thread-row-2">
                  <span className=${`thread-preview ${isSelf ? 'is-self' : ''}`}>
                    ${isSelf ? 'Bạn: ' : ''}
                    ${thread.lastHasImage ? '🖼️ [Hình ảnh]' : thread.lastContent || 'Bắt đầu cuộc trò chuyện'}
                  </span>

                  <div className="thread-badge-container">
                    ${thread.isManual && html`
                      <span className="badge-manual">-M</span>
                    `}
                    ${thread.targetCompany && html`
                      <span className="badge-company" title=${thread.targetCompany}>
                        ${thread.targetCompany}
                      </span>
                    `}
                  </div>
                </div>
              </div>
            </div>
          `;
        })}

        ${loadingThreads && html`
          <div style=${{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
            Đang tải dữ liệu...
          </div>
        `}
      </div>
    </aside>
  `;
}
