# Antigravity-Gemini-to-Local-OpenAI-API

Local Proxy Server hiệu năng cao chuyển đổi Google Antigravity CloudCode thành chuẩn OpenAI API (`http://127.0.0.1:8045/v1/chat/completions`) kèm **Giao diện Web UI Dashboard & Chatbot** tương thích 100% với **Kilo Code**, **Claude Code**, **Cursor**, **Cline**, v.v.

---

## 🌟 Tính Năng Chính

- **Giao diện Web UI Dashboard trực quan (`http://127.0.0.1:8045/`):**
  - 💬 **Chat Playground:** Trò chuyện trực tiếp với model, streaming token mượt mà, render Markdown và cú pháp code, khối hiển thị suy luận (Reasoning / Thinking) có thể đóng/mở.
  - 👥 **Quản lý tài khoản (Accounts):** Theo dõi trạng thái các tài khoản Google đã liên kết, bộ đếm cooldown, token refresh tự động.
  - 🔗 **Liên kết tài khoản 1-Click (`/oauth/login`):** Mở trình duyệt đăng nhập tài khoản Google Antigravity mới mà không cần copy paste token thủ công.
  - 🛠️ **Config Generator:** Nút 1-click copy cấu hình sẵn cho Kilo Code, Claude Code, cURL.
- **Danh mục Model tập trung (Đã tối ưu):**
  - `gemini-4-argon` / `gemini-4-argon-high`: Flagship reasoning model thế hệ mới nhất của Google (Argon, 1M context, giải toán/code/agent sâu).
  - `gemini-3.8-flash-high`: Model Gemini thông minh và cân bằng với khả năng suy luận chuyên sâu (Reasoning / Thinking).
  - `claude-opus-5-5-high`: Claude Opus 5.5 High qua hạ tầng Google CloudCode.
  - `claude-sonnet-5-5-high`: Claude Sonnet 5.5 High siêu tốc và chuẩn xác.
  - `claude-opus-4-6-thinking`: Tương thích ngược phiên bản Claude Opus 4.6 (tự động điều phối upstream thông minh).
  - `claude-sonnet-4-6`: Tương thích ngược phiên bản Claude Sonnet 4.6.
- **Hỗ trợ chuẩn OpenAI API v1:**
  - Hỗ trợ đầy đủ endpoint `GET /v1/models` và `POST /v1/chat/completions`.
  - Hỗ trợ cả **Streaming (SSE)** và **Non-Streaming**.
  - **Tự động lọc & chuẩn hóa Function Calling / Tool Schema:** Tương thích hoàn toàn với Kilo Code, MCP tools, Cursor, v.v. Tự động chuyển đổi các trường JSON Schema không được Google Protobuf hỗ trợ (`$schema`, `exclusiveMinimum`, `propertyNames`, `readOnly`, `writeOnly`, `$id`, `$defs`, v.v.) thành định dạng hợp lệ cho Gemini Schema.
  - **Xử lý Thought Signatures (Gemini 3 & 4):** Tự động bảo toàn và inject `thoughtSignature` / `skip_thought_signature_validator` trong các cuộc gọi tool đa lượt (multi-turn), loại bỏ triệt để lỗi thiếu signature của Gemini API.
- **Cơ chế Failover & Load Balancing:**
  - Tự động xoay vòng nhiều tài khoản Google (Round-robin).
  - Tự động làm mát và chuyển tài khoản khác khi gặp giới hạn tốc độ (429 Rate Limit).
  - Tự động fallback model alias nếu hạ tầng CloudCode chuyển đổi giữa cụm daily và prod.

---

## 🚀 Khởi Chạy & Sử Dụng

### 1. Cài đặt Dependencies:
```bash
npm install
```

### 2. Khởi chạy Server:
```bash
npm start
# Hoặc chạy chế độ dev (watch file thay đổi):
npm run dev
```
Server chạy tại: `http://127.0.0.1:8045`

### 3. Mở Web UI Dashboard:
Mở trình duyệt truy cập:
```
http://127.0.0.1:8045/
```
Bấm **Add Account via Google OAuth** để liên kết tài khoản Google Antigravity.

---

## 🛠️ Cấu Hình Sử Dụng Trong Kilo Code

Mở file cấu hình Kilo Code (`~/.config/kilo/kilo.jsonc` hoặc `./kilo.jsonc`) và thêm:

```jsonc
{
  "provider": {
    "aygfree": {
      "name": "AYGFree",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:8045/v1",
        "apiKey": "sk-local-antigravity"
      },
      "models": {
        "gemini-4-argon": {
          "name": "Gemini 4 Argon (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "gemini-4-argon-high": {
          "name": "Gemini 4 Argon High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "gemini-3.8-flash-high": {
          "name": "Gemini 3.8 Flash High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-opus-5-5-high": {
          "name": "Claude Opus 5.5 High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-sonnet-5-5-high": {
          "name": "Claude Sonnet 5.5 High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-opus-4-6-thinking": {
          "name": "Claude Opus 4.6 Thinking (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6 (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        }
      }
    }
  }
}
```

Sau đó trong Kilo Code, chọn model:
- `aygfree/gemini-4-argon`
- `aygfree/gemini-4-argon-high`
- `aygfree/gemini-3.8-flash-high`
- `aygfree/claude-opus-5-5-high`
- `aygfree/claude-sonnet-5-5-high`
- `aygfree/claude-opus-4-6-thinking`
- `aygfree/claude-sonnet-4-6`
- `aygfree/claude-sonnet-5-5-high`

---

## 🧪 Chạy Kiểm Thử Tự Động (Tests)

```bash
# Test danh sách models, Non-stream và Streaming
node tests/test_proxy.js

# Test Function Calling / Tools
node tests/test_tools.js

# Test Streaming Function Calling
node tests/test_stream_tools.js

# Test Reasoning / Thinking
node tests/test_thinking.js
```

---

## 📄 License
MIT
