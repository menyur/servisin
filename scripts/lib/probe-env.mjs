// ============================================================================
// scripts/lib/probe-env.mjs — helper bersama untuk probe LIVE Supabase.
//
// Dipakai oleh:
//   * scripts/verify-realtime.mjs          (matriks publication + mode --rls)
//   * scripts/verify-realtime-bookings.mjs (tautan lama, pembungkus tipis)
//   * scripts/audit-go-live-checks.mjs     (probe F3–F6)
//
// Prinsip: tidak pernah mencetak nilai rahasia; setiap baris/user uji yang
// dibuat SELALU disiapkan pembersihannya oleh pemanggil (lihat cleanupRows /
// deleteTempUsers).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * Sumber kredensial probe, TANPA pernah mencetak nilainya.
 *
 * Urutan (yang terakhir menang):
 *   1. file lokal `.env.local` (dilewati bila tidak ada — di CI tidak ada);
 *   2. variabel lingkungan proses — inilah jalur CI (GitHub Secrets) dan
 *      sengaja menang atas file supaya runner bisa menimpa nilai lokal.
 * Path file bisa diganti lewat PROBE_ENV_FILE (dipakai saat menguji skenario
 * "kredensial tidak tersedia").
 */
export function loadEnv(path = process.env.PROBE_ENV_FILE || ".env.local") {
  const env = {};

  if (path && existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== "") env[key] = value;
  }

  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    const err = new Error(`Kredensial probe tidak lengkap: ${missing.join(", ")}`);
    err.code = "NO_CREDENTIALS";
    err.missing = missing;
    throw err;
  }
  return env;
}

export function anonKey(env) {
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Kunci anon/publishable tidak ada di .env.local");
  return key;
}

const CLIENT_OPTS = { auth: { persistSession: false, autoRefreshToken: false } };

/** Klien service-role: melewati RLS (untuk fixture + pembersihan). */
export function makeAdminClient(env) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, CLIENT_OPTS);
}

/** Klien anon TANPA sesi (role `anon`) — untuk kontrol negatif & uji anon. */
export function makeAnonClient(env) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey(env), CLIENT_OPTS);
}

/** Klien anon yang nanti diisi sesi via signInWithPassword. */
export function makeUserClient(env) {
  return makeAnonClient(env);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Akun uji sementara
// ---------------------------------------------------------------------------

/**
 * Buat user uji (email @example.invalid → tidak pernah terkirim ke mana pun).
 * Trigger handle_new_user membuat baris profiles otomatis.
 */
export async function createTempUser(admin, role, label = "probe") {
  const email = `${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Probe!${randomUUID().replace(/-/g, "").slice(0, 12)}aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Probe ${label}`, role },
  });
  if (error) throw new Error(`createUser(${label}) gagal: ${error.message}`);
  await sleep(300); // beri waktu trigger handle_new_user menulis profiles
  return { id: data.user.id, email, password, role, label, cleanup: "pending" };
}

/** Hapus user uji (dan profilnya via cascade). Idempoten. */
export async function deleteTempUsers(admin, users) {
  const report = [];
  for (const u of users.filter(Boolean)) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    report.push({ label: u.label, id: u.id, ok: !error, error: error?.message ?? null });
  }
  return report;
}

/** Sisa baris uji yang gagal dihapus → cek ulang by id. */
export async function countRowsByIds(admin, table, ids) {
  if (!ids?.length) return 0;
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).in("id", ids);
  if (error) throw new Error(`countRowsByIds(${table}) gagal: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Watcher postgres_changes
// ---------------------------------------------------------------------------

const EVENT_TYPES = ["INSERT", "UPDATE", "DELETE"];

/**
 * Berlangganan postgres_changes pada satu tabel.
 * - `events` mencatat SETIAP payload yang diterima (untuk kontrol negatif).
 * - `waitFor(type, id, timeout)` menunggu satu event yang id-nya cocok
 *   (resolve null saat timeout — tidak pernah meng-crash alur).
 */
export function watch({ client, table, event = "*", filter, name }) {
  const channelName = `${name || `probe-${table}`}-${randomUUID()}`;
  const state = {
    table,
    filter: filter ?? null,
    subscribed: null,
    events: [],
    waiters: Object.fromEntries(EVENT_TYPES.map((t) => [t, []])),
  };

  const config = filter
    ? { event, schema: "public", table, filter }
    : { event, schema: "public", table };

  const channel = client
    .channel(channelName)
    .on("postgres_changes", config, (payload) => {
      const id = payload.new?.id ?? payload.old?.id ?? null;
      state.events.push({
        eventType: payload.eventType,
        id,
        oldKeys: Object.keys(payload.old || {}),
        newKeys: Object.keys(payload.new || {}),
        old: payload.old,
        new: payload.new,
      });
      const list = state.waiters[payload.eventType];
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].match(id)) {
          const w = list.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(payload);
          break;
        }
      }
    });

  const api = {
    state,
    channel,
    /** Tunggu status SUBSCRIBED/CHANNEL_ERROR/TIMED_OUT. */
    async subscribe(timeoutMs = 15000) {
      const status = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
        channel.subscribe((s) => {
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            clearTimeout(timer);
            resolve(s);
          }
        });
      });
      state.subscribed = status;
      return status;
    },
    /** Tunggu satu event bertipe `type`; matchId null = terima event apa pun. */
    waitFor(type, matchId = null, timeoutMs = 12000) {
      return new Promise((resolve) => {
        const entry = {
          match: (id) => matchId === null || id === null || id === matchId,
          resolve,
          timer: setTimeout(() => {
            const list = state.waiters[type];
            const i = list.indexOf(entry);
            if (i >= 0) list.splice(i, 1);
            resolve(null);
          }, timeoutMs),
        };
        state.waiters[type].push(entry);
      });
    },
    /** Semua event id yang cocok dengan id tertentu (untuk kontrol negatif). */
    eventsForId(id, type) {
      return state.events.filter((e) => e.id === id && (!type || e.eventType === type));
    },
    countForId(id) {
      return api.eventsForId(id).length;
    },
    async close() {
      try {
        await client.removeChannel(channel);
      } catch {
        /* kanal mungkin sudah tertutup */
      }
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Probe satu tabel: INSERT → UPDATE → DELETE, dengan retry pemanasan WAL
// ---------------------------------------------------------------------------

/**
 * Buktikan sebuah tabel benar-benar dipublikasikan realtime.
 * `makeRow(id, attempt)` mengembalikan baris uji lengkap (tanpa `id`).
 */
export async function probeTable({
  client,
  table,
  makeRow,
  updatePatch,
  timeoutMs = 12000,
  warmupMs = 1500,
  insertAttempts = 3,
  expectFullIdentity = true,
  log = () => {},
}) {
  const w = watch({ client, table, name: `verify-${table}` });
  const result = {
    table,
    expectFullIdentity,
    subscribed: null,
    insert: null,
    update: null,
    delete: null,
    insertedIds: [],
    cleaned: false,
    events: w.state.events,
  };

  result.subscribed = await w.subscribe();
  if (result.subscribed !== "SUBSCRIBED") {
    await w.close();
    return result;
  }

  await sleep(warmupMs);

  // Retry INSERT: subscriber baru bisa kehilangan event selama slot WAL
  // "memanas" (event berikutnya masuk normal), jadi satu kali tanpa event
  // belum berarti tabel tidak dipublikasikan.
  for (let attempt = 1; attempt <= insertAttempts; attempt++) {
    const id = randomUUID();
    const wait = w.waitFor("INSERT", id, timeoutMs);
    const { data, error } = await client
      .from(table)
      .insert({ ...makeRow(id, attempt), id })
      .select("id")
      .single();
    if (error) {
      result.insert = { ok: false, attempts: attempt, error: error.message };
      break;
    }
    result.insertedIds.push(data.id);
    const evt = await wait;
    if (evt) {
      result.insert = { ok: true, attempts: attempt, id: data.id };
      log(`  ${table}: INSERT diterima (percobaan ${attempt})`);
      break;
    }
    result.insert = { ok: false, attempts: attempt, error: `nol event dalam ${timeoutMs} ms` };
    log(`  ${table}: percobaan INSERT ${attempt} tanpa event`);
    if (attempt < insertAttempts) await sleep(warmupMs);
  }

  const probeId = result.insertedIds.at(-1) ?? null;

  if (probeId && updatePatch) {
    const wait = w.waitFor("UPDATE", probeId, timeoutMs);
    const { error } = await client.from(table).update(updatePatch).eq("id", probeId).select("id");
    const evt = await wait;
    result.update = {
      ok: Boolean(evt),
      error: error?.message ?? null,
      oldKeys: Object.keys(evt?.old || {}),
      newKeys: Object.keys(evt?.new || {}),
      oldStatus: evt?.old?.status ?? null,
      newStatus: evt?.new?.status ?? null,
      patched: updatePatch,
    };
  }

  if (result.insertedIds.length) {
    const wait = w.waitFor("DELETE", probeId, timeoutMs);
    const { error } = await client.from(table).delete().in("id", result.insertedIds);
    const evt = await wait;
    result.delete = { ok: Boolean(evt), error: error?.message ?? null, deleted: result.insertedIds.length };
    result.cleaned = !error;
  }

  await w.close();
  return result;
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

export function verdictFor(result) {
  const parts = [];
  parts.push(`${result.table}: channel=${result.subscribed}`);
  parts.push(`INSERT=${result.insert?.ok ? "YA" : "TIDAK"}`);
  if (result.update) parts.push(`UPDATE=${result.update.ok ? "YA" : "TIDAK"}`);
  parts.push(`DELETE=${result.delete?.ok ? "YA" : "TIDAK"}`);
  return parts.join(" · ");
}

export function isLive(result) {
  // Cukup UPDATE+DELETE (atau INSERT+UPDATE) untuk membuktikan publikasi;
  // INSERT pertama memang bisa hilang saat pemanasan.
  const ok = [result.update?.ok, result.delete?.ok, result.insert?.ok].filter(Boolean).length;
  return ok >= 2;
}
