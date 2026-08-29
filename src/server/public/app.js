import React, { useState, useEffect, useCallback, useRef } from 'https://esm.sh/react@19';
import ReactDOM from 'https://esm.sh/react-dom@19/client';
import htm from 'https://esm.sh/htm';

import { Sidebar } from './components/Sidebar.js';
import { ChatArea } from './components/ChatArea.js';
import { LightboxModal, RenameModal, NewThreadModal } from './components/Modals.js';
import { Toast } from './components/Toast.js';

const html = htm.bind(React.createElement);

function App() {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(window.__INITIAL_THREAD_ID__ || null);
  const [historyData, setHistoryData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  const [loadingThreads, setLoadingThreads] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);

  const [loadingHistory, setLoadingHistory] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isNewThreadModalOpen, setIsNewThreadModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const [ownId, setOwnId] = useState(window.__LOGGED_IN_ID__ || '');
  const searchTimeoutRef = useRef(null);

  // Ref giữ threadId hiện tại để SSE listener luôn nhận đúng
  const activeThreadIdRef = useRef(activeThreadId);
  const historyDataRef = useRef(historyData);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    historyDataRef.current = historyData;
  }, [historyData]);

  const showToast = (msg, duration = 3000) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), duration);
  };

  // 1. Tải danh sách cuộc trò chuyện
  const fetchThreads = useCallback(
    async (reset = false, search = searchQuery, filter = filterMode, offset = 0) => {
      setLoadingThreads(true);
      try {
        const params = new URLSearchParams({
          limit: '25',
          offset: String(reset ? 0 : offset),
          filter,
          search: search.trim(),
        });
        const res = await fetch(`/api/chat/threads?${params.toString()}`);
        const data = await res.json();

        if (data.success) {
          if (reset) {
            setThreads(data.threads || []);
          } else {
            setThreads((prev) => [...prev, ...(data.threads || [])]);
          }
          setHasMoreThreads(Boolean(data.hasMore));
          setNextOffset(data.nextOffset || 0);
        }
      } catch (err) {
        console.error('Lỗi khi tải danh sách cuộc trò chuyện:', err);
      } finally {
        setLoadingThreads(false);
      }
    },
    [searchQuery, filterMode]
  );

  // Khởi động nạp threads
  useEffect(() => {
    fetchThreads(true, searchQuery, filterMode, 0);
  }, [filterMode]);

  // Debounce search query
  const handleSearchChange = (query) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      fetchThreads(true, query, filterMode, 0);
    }, 300);
  };

  const handleLoadMoreThreads = () => {
    if (!loadingThreads && hasMoreThreads) {
      fetchThreads(false, searchQuery, filterMode, nextOffset);
    }
  };

  // 2. Tải lịch sử cuộc trò chuyện
  const fetchHistory = useCallback(async (threadId, before = null) => {
    if (!threadId) return;
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ thread: threadId, limit: '30' });
      if (before) params.append('before', String(before));

      const res = await fetch(`/api/chat/history?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        if (before) {
          setHistoryData((prev) => {
            if (!prev) return data;
            return {
              ...data,
              messages: [...(data.messages || []), ...(prev.messages || [])],
            };
          });
        } else {
          setHistoryData(data);
        }
      }
    } catch (err) {
      console.error('Lỗi khi tải lịch sử tin nhắn:', err);
      showToast('❌ Không thể tải lịch sử tin nhắn');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Khi chọn thread mới
  const handleSelectThread = (threadId) => {
    if (threadId === activeThreadId) return;
    setActiveThreadId(threadId);
    setHistoryData(null);
    fetchHistory(threadId);

    const url = new URL(window.location);
    url.searchParams.set('thread', threadId);
    window.history.pushState({}, '', url);
  };

  useEffect(() => {
    if (activeThreadId) {
      fetchHistory(activeThreadId);
    }
  }, [activeThreadId, fetchHistory]);

  const handleLoadOlderMessages = () => {
    if (!historyData || !historyData.oldestTimestamp || loadingHistory) return;
    fetchHistory(activeThreadId, historyData.oldestTimestamp);
  };

  // 3. Gửi tin nhắn văn bản
  const handleSendMessage = async (text) => {
    if (!activeThreadId || !text.trim()) return;

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          message: text.trim(),
          content: text.trim(),
          isGroup: historyData?.isGroup || false,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(`❌ Lỗi gửi tin: ${data.error || 'Thất bại'}`);
      }
    } catch (err) {
      showToast('❌ Lỗi kết nối khi gửi tin nhắn');
    }
  };

  // 4. Gửi một hoặc nhiều hình ảnh
  const handleSendImages = async (dataUrls, caption) => {
    if (!activeThreadId || !dataUrls || dataUrls.length === 0) return;

    try {
      const res = await fetch('/api/chat/send-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          images: dataUrls,
          content: caption || '',
          isGroup: historyData?.isGroup || false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã gửi ${dataUrls.length} hình ảnh thành công`);
      } else {
        showToast(`❌ Lỗi gửi ảnh: ${data.error || 'Thất bại'}`);
      }
    } catch (err) {
      showToast('❌ Lỗi kết nối khi gửi hình ảnh');
    }
  };

  // 5. Chuyển đổi chế độ AI / Thủ công (-M)
  const handleToggleMode = async () => {
    if (!activeThreadId) return;

    const currentMode = historyData?.isManual ? 'manual' : 'ai';
    const targetMode = currentMode === 'ai' ? 'manual' : 'ai';

    try {
      const res = await fetch('/api/chat/toggle-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          targetMode,
          isGroup: historyData?.isGroup || false,
        }),
      });
      const data = await res.json();

      if (data.success) {
        const isNowManual = data.mode === 'manual';
        setHistoryData((prev) =>
          prev ? { ...prev, isManual: isNowManual, threadName: data.newName } : null
        );

        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === activeThreadId
              ? { ...t, isManual: isNowManual, threadName: data.newName }
              : t
          )
        );

        showToast(
          isNowManual
            ? '✋ Đã chuyển sang chế độ Thủ công (-M)'
            : '🤖 Đã bật lại chế độ AI Tự động'
        );
      }
    } catch (err) {
      showToast('❌ Không thể chuyển đổi chế độ');
    }
  };

  // 6. Đổi tên Zalo
  const handleRename = async (newName) => {
    if (!activeThreadId || !newName.trim()) return;

    try {
      const res = await fetch('/api/chat/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          newName: newName.trim(),
          isGroup: historyData?.isGroup || false,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setHistoryData((prev) =>
          prev ? { ...prev, threadName: data.newName } : null
        );
        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === activeThreadId ? { ...t, threadName: data.newName } : t
          )
        );
        showToast('✅ Đã đổi tên thành công');
      } else {
        showToast(`⚠️ Không thể đổi tên trên Zalo: ${data.error}`);
      }
    } catch (err) {
      showToast('❌ Lỗi kết nối khi đổi tên');
    }
  };

  // 7. Kết nối SSE Realtime Events Bền Vững (Single Persistent Stream)
  useEffect(() => {
    let evtSource = null;
    let reconnectTimeout = null;

    const connectSSE = () => {
      evtSource = new EventSource('/api/chat/events');

      evtSource.onmessage = (event) => {
        try {
          if (!event.data || event.data.startsWith(':')) return;
          const payload = JSON.parse(event.data);

          if (payload.type === 'new_message' && payload.data) {
            const newMsg = payload.data;
            const currentActiveId = activeThreadIdRef.current;
            const currentHistory = historyDataRef.current;

            // 1. Cập nhật vào timeline nếu tin nhắn thuộc thread đang mở
            if (currentActiveId && String(newMsg.threadId) === String(currentActiveId)) {
              const own = window.__LOGGED_IN_ID__ || '';
              const isSelf = newMsg.role === 'model' || (own && newMsg.senderId === own) || newMsg.senderId === 'admin';
              const enrichedMsg = {
                ...newMsg,
                mediaType: newMsg.mediaType || null,
                mediaUrls: newMsg.mediaUrls || undefined,
                senderName: isSelf
                  ? 'Admin (Tôi)'
                  : !newMsg.isGroup
                  ? currentHistory?.threadName || newMsg.senderName || 'Ứng viên'
                  : newMsg.senderName || `Thành viên (${newMsg.senderId})`,
              };

              setHistoryData((prev) => {
                if (!prev) {
                  return {
                    success: true,
                    threadId: currentActiveId,
                    threadName: enrichedMsg.senderName,
                    isGroup: Boolean(newMsg.isGroup),
                    messages: [enrichedMsg],
                  };
                }
                const exists = prev.messages?.some((m) => m.id === enrichedMsg.id);
                if (exists) {
                  return {
                    ...prev,
                    messages: prev.messages.map((m) => (m.id === enrichedMsg.id ? { ...m, ...enrichedMsg } : m)),
                  };
                }
                return {
                  ...prev,
                  messages: [...(prev.messages || []), enrichedMsg],
                };
              });
            }

            // 2. Cập nhật Sidebar và đưa thread lên đầu danh sách tức thì
            setThreads((prev) => {
              const foundIndex = prev.findIndex((t) => String(t.threadId) === String(newMsg.threadId));
              const isManualMsg =
                !newMsg.isGroup &&
                (/^-M(\s|_|-|$)/i.test(newMsg.senderName) ||
                  (foundIndex >= 0 && prev[foundIndex].isManual));

              const lastContent =
                newMsg.content ||
                (newMsg.mediaType === 'photo'
                  ? '[Hình ảnh]'
                  : newMsg.mediaType === 'voice'
                  ? '[Tin nhắn thoại]'
                  : newMsg.mediaType === 'sticker'
                  ? '[Nhãn dán]'
                  : '');

              const updatedItem =
                foundIndex >= 0
                  ? {
                      ...prev[foundIndex],
                      lastContent,
                      lastMediaType: newMsg.mediaType,
                      lastHasImage: newMsg.mediaType === 'photo',
                      lastHasVoice: newMsg.mediaType === 'voice',
                      lastHasSticker: newMsg.mediaType === 'sticker',
                      lastTimestamp: newMsg.timestamp || Date.now(),
                      lastRole: newMsg.role,
                    }
                  : {
                      threadId: newMsg.threadId,
                      threadName: newMsg.senderName || `Khách ${String(newMsg.threadId).slice(-4)}`,
                      isGroup: Boolean(newMsg.isGroup),
                      isManual: Boolean(isManualMsg),
                      lastContent,
                      lastMediaType: newMsg.mediaType,
                      lastHasImage: newMsg.mediaType === 'photo',
                      lastHasVoice: newMsg.mediaType === 'voice',
                      lastHasSticker: newMsg.mediaType === 'sticker',
                      lastTimestamp: newMsg.timestamp || Date.now(),
                      lastRole: newMsg.role,
                    };

              const filtered = prev.filter((t) => String(t.threadId) !== String(newMsg.threadId));
              return [updatedItem, ...filtered];
            });
          } else if (payload.type === 'thread_renamed' && payload.data) {
            const { threadId, newName } = payload.data;
            if (String(threadId) === String(activeThreadIdRef.current)) {
              setHistoryData((prev) => (prev ? { ...prev, threadName: newName } : null));
            }
            setThreads((prev) =>
              prev.map((t) => (String(t.threadId) === String(threadId) ? { ...t, threadName: newName } : t))
            );
          }
        } catch (err) {
          console.warn('Lỗi phân tích SSE payload:', err);
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    return () => {
      if (evtSource) evtSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  const activeThread = threads.find((t) => t.threadId === activeThreadId) || (activeThreadId ? { threadId: activeThreadId, threadName: historyData?.threadName || `Thread ${activeThreadId}` } : null);

  return html`
    <div className="zalo-app-wrapper">
      <${Sidebar}
        threads=${threads}
        activeThreadId=${activeThreadId}
        onSelectThread=${handleSelectThread}
        searchQuery=${searchQuery}
        onSearchChange=${handleSearchChange}
        filterMode=${filterMode}
        onFilterChange=${setFilterMode}
        onOpenNewThreadModal=${() => setIsNewThreadModalOpen(true)}
        onLoadMoreThreads=${handleLoadMoreThreads}
        hasMoreThreads=${hasMoreThreads}
        loadingThreads=${loadingThreads}
        hideOnMobile=${Boolean(activeThreadId)}
      />

      <${ChatArea}
        activeThread=${activeThread}
        historyData=${historyData}
        loadingHistory=${loadingHistory}
        onBackToSidebar=${() => setActiveThreadId(null)}
        onSendMessage=${handleSendMessage}
        onSendImages=${handleSendImages}
        onToggleMode=${handleToggleMode}
        onOpenRenameModal=${() => setIsRenameModalOpen(true)}
        onLoadOlderMessages=${handleLoadOlderMessages}
        onImageClick=${(url) => setLightboxImage(url)}
        ownId=${ownId}
      />

      <${LightboxModal}
        imageUrl=${lightboxImage}
        onClose=${() => setLightboxImage(null)}
      />

      <${RenameModal}
        isOpen=${isRenameModalOpen}
        initialName=${historyData?.threadName || activeThread?.threadName || ''}
        isGroup=${historyData?.isGroup || false}
        onSave=${handleRename}
        onClose=${() => setIsRenameModalOpen(false)}
      />

      <${NewThreadModal}
        isOpen=${isNewThreadModalOpen}
        onOpenThread=${handleSelectThread}
        onClose=${() => setIsNewThreadModalOpen(false)}
      />

      <${Toast} message=${toastMessage} />
    </div>
  `;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App} />`);
