import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import initSqlJs, { type Database } from 'sql.js'
import { SCHEMA_SQL } from './schema'

/**
 * 基于 sql.js（WASM SQLite）的存储封装。零原生编译，任意机器可运行。
 * 整库在内存，写操作后落盘（防抖）。日志/清单库体量小，开销可忽略。
 * 对应 TECH_DESIGN.md §3（实现采用 WASM SQLite，见 §1 选型说明）。
 */
export class Db {
  private db: Database
  private dbPath: string
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false

  private constructor(db: Database, dbPath: string) {
    this.db = db
    this.dbPath = dbPath
  }

  /** wasmLocateFile：返回 sql-wasm.wasm 的绝对路径（打包后位置由调用方提供）。 */
  static async create(dbPath: string, wasmLocateFile?: (f: string) => string): Promise<Db> {
    const SQL = await initSqlJs(wasmLocateFile ? { locateFile: wasmLocateFile } : undefined)
    const data = existsSync(dbPath) ? readFileSync(dbPath) : undefined
    const db = new SQL.Database(data)
    db.run(SCHEMA_SQL)
    const instance = new Db(db, dbPath)
    if (!data) instance.flush() // 新库立即落盘
    return instance
  }

  private markDirty(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (this.dirty) this.flush()
    }, 400)
  }

  /** 立即把内存库写入磁盘。 */
  flush(): void {
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.dbPath, Buffer.from(this.db.export()))
    this.dirty = false
  }

  getSetting<T = unknown>(key: string, fallback: T): T {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    try {
      stmt.bind([key])
      if (!stmt.step()) return fallback
      const { value } = stmt.getAsObject() as { value: string }
      try {
        return JSON.parse(value) as T
      } catch {
        return fallback
      }
    } finally {
      stmt.free()
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    )
    this.markDirty()
  }

  logOperation(op: Record<string, unknown>): void {
    const cols = [
      'ts', 'op_type', 'path', 'dest_path', 'size_bytes', 'category', 'risk_level',
      'action', 'status', 'error_code', 'error_detail', 'user_confirm', 'ai_summary', 'batch_id'
    ]
    const placeholders = cols.map(() => '?').join(', ')
    const values = cols.map((c) => (op[c] === undefined ? null : (op[c] as never)))
    this.db.run(`INSERT INTO operations(${cols.join(', ')}) VALUES(${placeholders})`, values)
    this.markDirty()
  }

  /** 通用查询，返回对象数组。 */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    const rows: T[] = []
    try {
      stmt.bind(params as never)
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
    } finally {
      stmt.free()
    }
    return rows
  }

  /** 通用写入。 */
  run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as never)
    this.markDirty()
  }

  raw(): Database {
    return this.db
  }

  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.dirty) this.flush()
    this.db.close()
  }
}
