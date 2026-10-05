# hozin-chat-worker

Repo gabungan untuk Hozin Notes:

1. **Cloudflare Worker — backend chat acak** (`wrangler.toml`, `src/index.js`, `schema.sql`)
   - Deploy: hubungkan repo ini di dashboard Cloudflare (Workers → Create → Import from Git),
     atau `wrangler deploy` dari folder ini.
   - Buat database D1 `hozin_chat`, jalankan `schema.sql`, isi `database_id` di `wrangler.toml`
     (atau atur binding D1 di dashboard).
2. **Manifest auto-update Hozin Notes** (`hozin-notes-update.json`)
   - Dibaca aplikasi dari `https://raw.githubusercontent.com/hozin-king/hozin-chat-worker/main/hozin-notes-update.json`.
   - Tiap rilis: naikkan `versionCode`/`versionName`, tulis changelog.
