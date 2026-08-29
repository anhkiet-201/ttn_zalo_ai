/**
 * renderChatPage: Render giao diện Web Chat React 19 chuẩn Zalo Executive Light
 * Tách biệt hoàn toàn HTML Shell, CSS (/static/chat.css) và React Components (/static/app.js)
 */
export function renderChatPage(initialThreadId: string = "", initialOwnId: string = ""): string {
  const safeThreadId = JSON.stringify(initialThreadId || "");
  const safeOwnId = JSON.stringify(initialOwnId || "");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zalo AI Bot - Executive Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/chat.css?v=3">
  <script>
    window.__INITIAL_THREAD_ID__ = ${safeThreadId};
    window.__LOGGED_IN_ID__ = ${safeOwnId};
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/static/app.js?v=3"></script>
</body>
</html>`;
}
