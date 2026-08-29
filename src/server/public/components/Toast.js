import React from 'https://esm.sh/react@19';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

export function Toast({ message }) {
  if (!message) return null;

  return html`
    <div className="toast-container">
      <div className="toast-item">
        ${message}
      </div>
    </div>
  `;
}
