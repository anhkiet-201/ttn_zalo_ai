import React, { useState, useEffect } from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

/**
 * LightboxModal: Xem ảnh toàn màn hình với hiệu ứng mờ kính
 */
export function LightboxModal({ imageUrl, onClose }) {
  if (!imageUrl) return null;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return html`
    <div className="lightbox-backdrop" onClick=${onClose}>
      <button className="lightbox-close-btn" onClick=${onClose} title="Đóng (ESC)">
        ✕
      </button>
      <img
        src=${imageUrl}
        className="lightbox-image"
        alt="Zalo Image Full"
        onClick=${(e) => e.stopPropagation()}
      />
    </div>
  `;
}

/**
 * RenameModal: Đổi tên hiển thị / Đặt tên gợi nhớ Zalo
 */
export function RenameModal({ isOpen, initialName, isGroup, onSave, onClose }) {
  if (!isOpen) return null;

  const [newName, setNewName] = useState(initialName || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setNewName(initialName || '');
  }, [initialName, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newName.trim() || loading) return;

    setLoading(true);
    try {
      await onSave(newName.trim());
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return html`
    <div className="modal-backdrop" onClick=${onClose}>
      <div className="modal-dialog" onClick=${(e) => e.stopPropagation()}>
        <h3 className="modal-title">
          ${isGroup ? '✏️ Đổi tên Nhóm chat' : '✏️ Đặt tên gợi nhớ Zalo'}
        </h3>
        <p className="modal-desc">
          Tên này sẽ được cập nhật trực tiếp lên Zalo và lưu vào cơ sở dữ liệu hệ thống.
        </p>

        <form onSubmit=${handleSubmit}>
          <input
            type="text"
            className="modal-input"
            placeholder="Nhập tên mới..."
            value=${newName}
            onChange=${(e) => setNewName(e.target.value)}
            autoFocus
          />

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick=${onClose}
              disabled=${loading}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled=${loading || !newName.trim()}
            >
              ${loading ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/**
 * NewThreadModal: Mở đoạn chat với ID Zalo bất kỳ
 */
export function NewThreadModal({ isOpen, onOpenThread, onClose }) {
  if (!isOpen) return null;

  const [inputThreadId, setInputThreadId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanId = inputThreadId.trim();
    if (!cleanId) return;

    onOpenThread(cleanId);
    setInputThreadId('');
    onClose();
  };

  return html`
    <div className="modal-backdrop" onClick=${onClose}>
      <div className="modal-dialog" onClick=${(e) => e.stopPropagation()}>
        <h3 className="modal-title">💬 Mở đoạn chat mới</h3>
        <p className="modal-desc">
          Nhập Thread ID Zalo (ID người dùng hoặc ID nhóm) để bắt đầu trò chuyện.
        </p>

        <form onSubmit=${handleSubmit}>
          <input
            type="text"
            className="modal-input"
            placeholder="Ví dụ: 7022361798516490807"
            value=${inputThreadId}
            onChange=${(e) => setInputThreadId(e.target.value)}
            autoFocus
          />

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick=${onClose}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled=${!inputThreadId.trim()}
            >
              Bắt đầu chat
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}
