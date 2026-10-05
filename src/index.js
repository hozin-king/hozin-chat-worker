/**
 * Hozin Notes — Random Chat backend (Cloudflare Worker + D1).
 *
 * Endpoint:
 *   POST /api/identify {userId, name}        -> daftarkan/perbarui user
 *   POST /api/match    {userId}              -> cari pasangan; {roomId,peerName} atau {waiting:true}
 *   GET  /api/match?userId=                 -> poll hasil match untuk pendaftar pertama
 *   POST /api/leave    {userId}              -> keluar dari antrean
 *   GET  /api/messages?room=&after=&userId= -> daftar pesan (id > after)
 *   POST /api/send     {room, from, text}    -> kirim pesan (disensor server)
 *   POST /api/report   {room, reporter}      -> laporkan chat
 *   POST /api/block    {userId, peerId}      -> blokir user
 *
 * D1 binding: env.DB (lihat schema.sql).
 */

// Daftar kata kasar minimal di sisi server (defense in depth;
// filter utama tetap di aplikasi via BadWordFilter).
const BAD_WORDS = [
  "anjing", "babi", "kontol", "memek", "bangsat", "bajingan",
  "kampang", "jancuk", "cuk", "asu", "goblok", "tolol", "idiot",
];

function censor(text) {
  let out = String(text || "");
  for (const w of BAD_WORDS) {
    const re = new RegExp(w, "gi");
    out = out.replace(re, (m) => "*".repeat(m.length));
  }
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function cors() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function roomId() {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return "r_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors();
    const db = env.DB;
    if (!db) return json({ error: "d1_not_bound" }, 500);

    try {
      // ---------- identify ----------
      if (url.pathname === "/api/identify" && req.method === "POST") {
        const { userId, name } = await readJson(req);
        if (!userId || !name || String(name).trim().length === 0)
          return json({ error: "bad_request" }, 400);
        const now = Date.now();
        await db
          .prepare(
            "INSERT INTO users(user_id,name,created_at) VALUES(?,?,?) " +
              "ON CONFLICT(user_id) DO UPDATE SET name=excluded.name"
          )
          .bind(String(userId), String(name).trim().slice(0, 40), now)
          .run();
        return json({ ok: true });
      }

      // ---------- match (coba pasangkan sekarang) ----------
      if (url.pathname === "/api/match" && req.method === "POST") {
        const { userId } = await readJson(req);
        if (!userId) return json({ error: "bad_request" }, 400);
        const me = await db
          .prepare("SELECT user_id, name FROM users WHERE user_id=?")
          .bind(String(userId))
          .first();
        if (!me) return json({ error: "unknown_user" }, 400);

        // Bersihkan antrean basi (>90 dtk).
        await db
          .prepare("DELETE FROM queue WHERE enqueued_at < ?")
          .bind(Date.now() - 90000)
          .run();

        // Cari pasangan: paling lama menunggu, bukan diri sendiri,
        // dan tidak saling blokir.
        const cand = await db
          .prepare(
            `SELECT q.user_id, q.name FROM queue q
             WHERE q.user_id != ?
             AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.user_id=? AND b.peer_id=q.user_id)
             AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.user_id=q.user_id AND b.peer_id=?)
             ORDER BY q.enqueued_at ASC LIMIT 1`
          )
          .bind(me.user_id, me.user_id, me.user_id)
          .first();

        if (cand) {
          const rid = roomId();
          const now = Date.now();
          await db.batch([
            db
              .prepare("DELETE FROM queue WHERE user_id IN (?,?)")
              .bind(me.user_id, cand.user_id),
            db
              .prepare(
                "INSERT INTO rooms(room_id,a_id,b_id,created_at) VALUES(?,?,?,?)"
              )
              .bind(rid, me.user_id, cand.user_id, now),
          ]);
          return json({ roomId: rid, peerName: cand.name, peerId: cand.user_id });
        }

        // Belum ada pasangan: masuk antrean.
        await db
          .prepare(
            "INSERT OR REPLACE INTO queue(user_id,name,enqueued_at) VALUES(?,?,?)"
          )
          .bind(me.user_id, me.name, Date.now())
          .run();
        return json({ waiting: true });
      }

      // ---------- match status (poll untuk pendaftar pertama) ----------
      if (url.pathname === "/api/match" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId) return json({ error: "bad_request" }, 400);
        const room = await db
          .prepare(
            `SELECT room_id, a_id, b_id FROM rooms
             WHERE closed=0 AND ((a_id=? AND seen_a=0) OR (b_id=? AND seen_b=0))
             ORDER BY created_at DESC LIMIT 1`
          )
          .bind(userId, userId)
          .first();
        if (!room) return json({ waiting: true });
        const seenCol = room.a_id === userId ? "seen_a" : "seen_b";
        await db
          .prepare(`UPDATE rooms SET ${seenCol}=1 WHERE room_id=?`)
          .bind(room.room_id)
          .run();
        const peerId = room.a_id === userId ? room.b_id : room.a_id;
        const peer = await db
          .prepare("SELECT name FROM users WHERE user_id=?")
          .bind(peerId)
          .first();
        return json({
          roomId: room.room_id,
          peerName: peer ? peer.name : "Orang asing",
          peerId: peerId,
        });
      }

      // ---------- leave ----------
      if (url.pathname === "/api/leave" && req.method === "POST") {
        const { userId } = await readJson(req);
        if (userId) {
          await db
            .prepare("DELETE FROM queue WHERE user_id=?")
            .bind(String(userId))
            .run();
        }
        return json({ ok: true });
      }

      // ---------- messages ----------
      if (url.pathname === "/api/messages" && req.method === "GET") {
        const roomIdParam = url.searchParams.get("room");
        const userId = url.searchParams.get("userId");
        const after = parseInt(url.searchParams.get("after") || "0", 10) || 0;
        if (!roomIdParam || !userId) return json({ error: "bad_request" }, 400);
        const room = await db
          .prepare("SELECT a_id, b_id FROM rooms WHERE room_id=?")
          .bind(roomIdParam)
          .first();
        if (!room || (room.a_id !== userId && room.b_id !== userId))
          return json({ error: "forbidden" }, 403);
        const msgs = await db
          .prepare(
            "SELECT id, from_id AS fromId, text, ts FROM messages " +
              "WHERE room_id=? AND id>? ORDER BY id ASC LIMIT 100"
          )
          .bind(roomIdParam, after)
          .all();
        return json({ messages: msgs.results || [] });
      }

      // ---------- send ----------
      if (url.pathname === "/api/send" && req.method === "POST") {
        const { room, from, text } = await readJson(req);
        if (!room || !from || !text || String(text).trim().length === 0)
          return json({ error: "bad_request" }, 400);
        const roomRow = await db
          .prepare("SELECT a_id, b_id FROM rooms WHERE room_id=? AND closed=0")
          .bind(String(room))
          .first();
        if (!roomRow || (roomRow.a_id !== from && roomRow.b_id !== from))
          return json({ error: "forbidden" }, 403);
        const clean = censor(String(text)).trim().slice(0, 2000);
        const now = Date.now();
        const res = await db
          .prepare("INSERT INTO messages(room_id,from_id,text,ts) VALUES(?,?,?,?)")
          .bind(String(room), String(from), clean, now)
          .run();
        return json({ id: Number(res.meta.last_row_id), ts: now });
      }

      // ---------- report ----------
      if (url.pathname === "/api/report" && req.method === "POST") {
        const { room, reporter } = await readJson(req);
        if (!room || !reporter) return json({ error: "bad_request" }, 400);
        await db
          .prepare(
            "INSERT INTO reports(room_id,reporter_id,created_at) VALUES(?,?,?)"
          )
          .bind(String(room), String(reporter), Date.now())
          .run();
        return json({ ok: true });
      }

      // ---------- block ----------
      if (url.pathname === "/api/block" && req.method === "POST") {
        const { userId, peerId } = await readJson(req);
        if (!userId || !peerId) return json({ error: "bad_request" }, 400);
        await db
          .prepare(
            "INSERT OR IGNORE INTO blocks(user_id,peer_id,created_at) VALUES(?,?,?)"
          )
          .bind(String(userId), String(peerId), Date.now())
          .run();
        return json({ ok: true });
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "server_error" }, 500);
    }
  },
};
