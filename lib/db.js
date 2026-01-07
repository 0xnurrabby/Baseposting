const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Note: API routes will throw a clear error when invoked.
}

let _pool;
function pool() {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  return _pool;
}

let _migrated = false;

async function runMigrations() {
  if (_migrated) return;
  _migrated = true;

  const p = pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS raw_posts (
        tweet_id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        text TEXT NOT NULL,
        url TEXT,
        timestamp TIMESTAMPTZ NOT NULL,
        like_count INT NOT NULL DEFAULT 0,
        reply_count INT NOT NULL DEFAULT 0,
        retweet_count INT NOT NULL DEFAULT 0,
        quote_count INT NOT NULL DEFAULT 0,
        is_reply BOOLEAN NOT NULL DEFAULT false,
        is_retweet BOOLEAN NOT NULL DEFAULT false,
        raw JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS generated_posts (
        id BIGSERIAL PRIMARY KEY,
        fid BIGINT,
        tweet_id TEXT REFERENCES raw_posts(tweet_id) ON DELETE SET NULL,
        variant_index INT NOT NULL,
        style TEXT NOT NULL,
        length TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence TEXT NOT NULL,
        credit_on BOOLEAN NOT NULL DEFAULT true,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_credits (
        fid BIGINT PRIMARY KEY,
        credits INT NOT NULL DEFAULT 10,
        last_share_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_claims (
        tx_hash TEXT PRIMARY KEY,
        fid BIGINT,
        from_address TEXT,
        chain_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_tokens (
        fid BIGINT NOT NULL,
        app_fid BIGINT NOT NULL,
        token TEXT NOT NULL,
        url TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        enabled BOOLEAN NOT NULL DEFAULT true,
        PRIMARY KEY (fid, app_fid)
      );
    `);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    _migrated = false;
    throw e;
  } finally {
    client.release();
  }
}

async function q(text, params) {
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL env var.");
  await runMigrations();
  return pool().query(text, params);
}

async function withTx(fn) {
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL env var.");
  await runMigrations();
  const p = pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function qClient(client, text, params) {
  return client.query(text, params);
}

module.exports = { q, qClient, runMigrations, withTx };

