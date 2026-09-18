import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { Endpoint, FileRecord, UnionEvent, UnionMessage } from "../core/types"

export class UnionDatabase {
  readonly db: Database

  constructor(public readonly path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA foreign_keys = ON;")
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        extension TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        summary TEXT,
        canonical INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS files_subject_idx ON files(subject, title);
      CREATE INDEX IF NOT EXISTS files_modified_idx ON files(modified_at DESC);

      CREATE TABLE IF NOT EXISTS endpoints (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        system TEXT NOT NULL,
        title TEXT NOT NULL,
        subject TEXT,
        status TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        external_id TEXT,
        url TEXT,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        endpoint_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_endpoint_idx ON messages(endpoint_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        object_id TEXT,
        subject TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at DESC);
      CREATE INDEX IF NOT EXISTS events_subject_idx ON events(subject, created_at DESC);

      CREATE TABLE IF NOT EXISTS relations (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id, kind)
      );
    `)
  }

  upsertFile(file: FileRecord) {
    this.db.query(`
      INSERT INTO files (id,path,title,subject,extension,size,modified_at,indexed_at,summary,canonical)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET
        title=excluded.title, subject=excluded.subject, extension=excluded.extension,
        size=excluded.size, modified_at=excluded.modified_at, indexed_at=excluded.indexed_at,
        summary=excluded.summary
    `).run(file.id, file.path, file.title, file.subject, file.extension, file.size, file.modifiedAt, file.indexedAt, file.summary ?? null, file.canonical ? 1 : 0)
  }

  listFiles(limit = 5000): FileRecord[] {
    return this.db.query(`SELECT id,path,title,subject,extension,size,modified_at AS modifiedAt,indexed_at AS indexedAt,summary,canonical FROM files ORDER BY subject COLLATE NOCASE, title COLLATE NOCASE LIMIT ?`).all(limit).map((row: any) => ({ ...row, canonical: Boolean(row.canonical) })) as FileRecord[]
  }

  filesForSubject(subject: string, limit = 500): FileRecord[] {
    return this.db.query(`SELECT id,path,title,subject,extension,size,modified_at AS modifiedAt,indexed_at AS indexedAt,summary,canonical FROM files WHERE subject = ? ORDER BY title COLLATE NOCASE LIMIT ?`).all(subject, limit).map((row: any) => ({ ...row, canonical: Boolean(row.canonical) })) as FileRecord[]
  }

  upsertEndpoint(endpoint: Endpoint) {
    this.db.query(`
      INSERT INTO endpoints (id,adapter_id,system,title,subject,status,capabilities,external_id,url,metadata,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, subject=excluded.subject, status=excluded.status,
        capabilities=excluded.capabilities, url=excluded.url, metadata=excluded.metadata, updated_at=excluded.updated_at
    `).run(
      endpoint.id, endpoint.adapterId, endpoint.system, endpoint.title, endpoint.subject ?? null, endpoint.status,
      JSON.stringify(endpoint.capabilities), endpoint.externalId ?? null, endpoint.url ?? null,
      JSON.stringify(endpoint.metadata ?? {}), endpoint.updatedAt,
    )
  }

  listEndpoints(): Endpoint[] {
    return this.db.query(`SELECT * FROM endpoints ORDER BY system COLLATE NOCASE, title COLLATE NOCASE`).all().map((row: any) => ({
      id: row.id,
      adapterId: row.adapter_id,
      system: row.system,
      title: row.title,
      subject: row.subject ?? undefined,
      status: row.status,
      capabilities: JSON.parse(row.capabilities),
      externalId: row.external_id ?? undefined,
      url: row.url ?? undefined,
      metadata: JSON.parse(row.metadata || "{}"),
      updatedAt: row.updated_at,
    })) as Endpoint[]
  }

  addMessage(message: UnionMessage) {
    this.db.query(`INSERT OR REPLACE INTO messages (id,endpoint_id,role,content,metadata,created_at) VALUES (?,?,?,?,?,?)`).run(
      message.id, message.endpointId, message.role, message.content, JSON.stringify(message.metadata ?? {}), message.createdAt,
    )
  }

  recentMessages(limit = 100): UnionMessage[] {
    return this.db.query(`SELECT id,endpoint_id AS endpointId,role,content,metadata,created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT ?`).all(limit).map((row: any) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })) as UnionMessage[]
  }

  messagesForEndpoint(endpointId: string, limit = 24): UnionMessage[] {
    const rows = this.db.query(`
      SELECT id,endpoint_id AS endpointId,role,content,metadata,created_at AS createdAt
      FROM messages
      WHERE endpoint_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(endpointId, limit).map((row: any) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })) as UnionMessage[]
    return rows.reverse()
  }

  addEvent(event: UnionEvent) {
    this.db.query(`INSERT INTO events (id,type,object_id,subject,payload,created_at) VALUES (?,?,?,?,?,?)`).run(
      event.id, event.type, event.objectId ?? null, event.subject ?? null, JSON.stringify(event.payload), event.createdAt,
    )
  }

  recentEvents(limit = 50): UnionEvent[] {
    return this.db.query(`SELECT id,type,object_id AS objectId,subject,payload,created_at AS createdAt FROM events ORDER BY created_at DESC LIMIT ?`).all(limit).map((row: any) => ({ ...row, payload: JSON.parse(row.payload) })) as UnionEvent[]
  }

  relate(sourceId: string, targetId: string, kind: string, weight = 1) {
    this.db.query(`INSERT OR REPLACE INTO relations (source_id,target_id,kind,weight,created_at) VALUES (?,?,?,?,?)`).run(sourceId, targetId, kind, weight, Date.now())
  }

  close() { this.db.close() }
}
