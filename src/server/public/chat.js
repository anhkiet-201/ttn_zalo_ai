    (function() {
      const appConfig = window.APP_CONFIG || {};
      let currentThreadId = appConfig.initialThreadId || "";
      let currentOwnId = appConfig.initialOwnId || "";
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
        const rawPreviewText = t.lastHasImage
          ? "🖼️ [Hình ảnh]"
          : (t.lastHasVoice || (t.lastContent && t.lastContent.includes("[🎙️ Tin nhắn thoại]")))
          ? "🎙️ [Tin nhắn thoại]"
          : (t.lastContent || "Bắt đầu cuộc trò chuyện");
        const safeName = escapeHtml(t.threadName || t.threadId);
        const safePreview = escapeHtml(previewPrefix + rawPreviewText);
        const safeCompany = t.targetCompany ? escapeHtml(t.targetCompany) : "";

        div.innerHTML = `
          <div class="${avatarClass}">
            <span>${escapeHtml(t.avatarLetter || "Z")}</span>
            <div class="thread-online-dot"></div>
          </div>
          <div class="thread-item-body">
            <div class="thread-item-row1">
              <span class="thread-item-name">${safeName}</span>
              <span class="thread-item-time">${formatTime(t.lastTimestamp)}</span>
            </div>
            <div class="thread-item-row2">
              <span class="thread-item-preview ${isSelfLast ? 'is-self' : ''}">${safePreview}</span>
              <div class="thread-badge-group">
                ${safeCompany ? '<span class="thread-badge-candidate">' + safeCompany + '</span>' : ''}
                ${t.isManual ? '<span class="thread-badge-manual">-M</span>' : ''}
              </div>
            </div>
          </div>
        `;

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
          const previewText = t.lastHasImage
            ? "🖼️ [Hình ảnh]"
            : (t.lastHasVoice || (t.lastContent && t.lastContent.includes("[🎙️ Tin nhắn thoại]")))
            ? "🎙️ [Tin nhắn thoại]"
            : (t.lastContent || "Đoạn chat");
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

      // Quản lý audio đang phát để tự động dừng khi phát audio khác
      let currentlyPlayingAudio = null;

      function formatAudioDuration(seconds) {
        if (isNaN(seconds) || seconds < 0) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
      }

      // Chiều cao mô phỏng dạng sóng âm thanh chuẩn Zalo (28 cột sóng)
      const WAVEFORM_HEIGHTS = [
        6, 12, 18, 10, 14, 22, 16, 8, 12, 20, 24, 18, 14, 22,
        20, 16, 12, 18, 24, 16, 10, 14, 20, 16, 12, 8, 14, 6
      ];

      /**
       * Xây dựng Widget Voice Message chuẩn phong cách Zalo
       */
      function buildZaloVoiceWidget(msg, isSelf) {
        const container = document.createElement("div");
        container.className = "zalo-voice-card " + (isSelf ? "is-self" : "is-other");

        const initialDur = msg.voiceDuration ? Math.round(msg.voiceDuration / 1000) : 0;
        const initialDurStr = initialDur > 0 ? formatAudioDuration(initialDur) : "0:00";

        container.innerHTML = `
          <button class="zalo-voice-play-btn" type="button" title="Phát tin nhắn thoại">
            <svg class="voice-icon-play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
            <svg class="voice-icon-pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:none;">
              <rect x="6" y="4" width="4" height="16" rx="1"></rect>
              <rect x="14" y="4" width="4" height="16" rx="1"></rect>
            </svg>
            <div class="voice-spinner" style="display:none;"></div>
          </button>
          <div class="zalo-voice-content">
            <div class="zalo-voice-waveform" title="Tua âm thanh">
              ${WAVEFORM_HEIGHTS.map((h, i) => `<span class="waveform-bar" data-idx="${i}" style="height:${h}px"></span>`).join("")}
            </div>
            <div class="zalo-voice-meta">
              <span class="zalo-voice-time">${initialDurStr}</span>
              <button class="zalo-voice-speed-btn" type="button" title="Tốc độ phát">1x</button>
            </div>
          </div>
          <audio class="zalo-voice-audio-el" preload="metadata" src="${escapeHtml(msg.voiceUrl)}"></audio>
        `;

        const playBtn = container.querySelector(".zalo-voice-play-btn");
        const iconPlay = container.querySelector(".voice-icon-play");
        const iconPause = container.querySelector(".voice-icon-pause");
        const spinner = container.querySelector(".voice-spinner");
        const waveform = container.querySelector(".zalo-voice-waveform");
        const bars = container.querySelectorAll(".waveform-bar");
        const timeLabel = container.querySelector(".zalo-voice-time");
        const speedBtn = container.querySelector(".zalo-voice-speed-btn");
        const audio = container.querySelector(".zalo-voice-audio-el");

        let isPlaying = false;
        let currentSpeedIdx = 0;
        const speeds = [1.0, 1.5, 2.0];

        function updateProgress() {
          const dur = audio.duration || initialDur || 1;
          const cur = audio.currentTime || 0;
          const progress = Math.min(cur / dur, 1);
          
          const activeCount = Math.round(progress * bars.length);
          bars.forEach((bar, idx) => {
            if (idx < activeCount) {
              bar.classList.add("active");
            } else {
              bar.classList.remove("active");
            }
          });

          if (isPlaying) {
            timeLabel.textContent = `${formatAudioDuration(cur)} / ${formatAudioDuration(dur)}`;
          } else {
            timeLabel.textContent = formatAudioDuration(dur);
          }
        }

        function setPlayingState(playing) {
          isPlaying = playing;
          if (playing) {
            iconPlay.style.display = "none";
            iconPause.style.display = "block";
            playBtn.classList.add("playing");
          } else {
            iconPlay.style.display = "block";
            iconPause.style.display = "none";
            playBtn.classList.remove("playing");
          }
        }

        playBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (audio.paused) {
            if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
              currentlyPlayingAudio.pause();
            }
            currentlyPlayingAudio = audio;
            audio.play().catch(err => console.warn("Lỗi phát audio:", err));
          } else {
            audio.pause();
          }
        });

        waveform.addEventListener("click", (e) => {
          e.stopPropagation();
          const rect = waveform.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const percent = Math.max(0, Math.min(1, clickX / rect.width));
          const dur = audio.duration || initialDur || 0;
          if (dur > 0) {
            audio.currentTime = percent * dur;
            updateProgress();
          }
        });

        speedBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          currentSpeedIdx = (currentSpeedIdx + 1) % speeds.length;
          const speed = speeds[currentSpeedIdx];
          audio.playbackRate = speed;
          speedBtn.textContent = `${speed}x`;
        });

        audio.addEventListener("play", () => {
          setPlayingState(true);
        });

        audio.addEventListener("pause", () => {
          setPlayingState(false);
          updateProgress();
        });

        audio.addEventListener("ended", () => {
          setPlayingState(false);
          audio.currentTime = 0;
          bars.forEach(b => b.classList.remove("active"));
          const dur = audio.duration || initialDur || 0;
          timeLabel.textContent = formatAudioDuration(dur);
          if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
        });

        audio.addEventListener("timeupdate", updateProgress);

        audio.addEventListener("loadedmetadata", () => {
          if (!isPlaying) {
            timeLabel.textContent = formatAudioDuration(audio.duration || initialDur);
          }
        });

        audio.addEventListener("waiting", () => {
          spinner.style.display = "block";
          iconPlay.style.display = "none";
          iconPause.style.display = "none";
        });

        audio.addEventListener("playing", () => {
          spinner.style.display = "none";
          setPlayingState(true);
        });

        return container;
      }

      // Tạo một bubble tin nhắn
      function createMessageElement(msg, isOptimistic = false) {
        const cleanText = sanitizeContent(msg.content);
        const hasValidImages = Boolean(msg.hasImage && msg.imageUrls && Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0);
        const hasValidVoice = Boolean(msg.hasVoice && msg.voiceUrl);

        if (!cleanText && !hasValidImages && !hasValidVoice) return null;

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
          quoteCardEl.innerHTML = `
            <span class="quote-sender">↪️ ${qSender}</span>
            <span class="quote-text">${qText}</span>
          `;
        }

        // Ảnh
        if (hasValidImages && !cleanText && !hasValidVoice) {
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
              progressOverlay.innerHTML = `
                <div class="progress-spinner"></div>
                <div class="progress-text">Đang gửi...</div>
              `;
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

          if (hasValidVoice) {
            bubble.appendChild(buildZaloVoiceWidget(msg, isSelf));
          }

          if (cleanText) {
            const textEl = document.createElement("div");
            if (cleanText === "[Sticker]") {
              textEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;font-style:italic;color:#475569;">🏷️ [Nhãn dán / Sticker]</span>';
            } else if (cleanText.startsWith("[🎙️ Tin nhắn thoại]:")) {
              const sttContent = cleanText.replace("[🎙️ Tin nhắn thoại]:", "").trim().replace(/^["\s]+|["\s]+$/g, "");
              textEl.className = "msg-stt-box";
              textEl.innerHTML = `<div class="msg-stt-title">📝 Nội dung phiên âm:</div><div class="msg-stt-body">${escapeHtml(sttContent)}</div>`;
            } else {
              textEl.textContent = cleanText;
            }
            bubble.appendChild(textEl);
          }

          if (hasValidImages) {
            const imagesContainer = document.createElement("div");
            imagesContainer.className = "msg-images";
            imagesContainer.style.marginTop = (cleanText || hasValidVoice) ? "8px" : "0";

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
          const res = await fetch(`/api/chat/history?thread=${encodeURIComponent(currentThreadId)}&before=${oldestMessageTimestamp}&limit=30`);
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
