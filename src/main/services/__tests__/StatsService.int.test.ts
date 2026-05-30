import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { BackupService } from '../BackupService'
import { StatsService } from '../StatsService'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

let base: string
afterEach(() => {
  if (base && existsSync(base)) rmSync(base, { recursive: true, force: true })
})

async function setup(): Promise<{ db: Db; stats: StatsService }> {
  base = mkdtempSync(join(process.cwd(), 'itmp-'))
  const db = await Db.create(join(base, 'app.db'), locate)
  // 一条已完成扫描
  db.run(
    `INSERT INTO scans(type, started_at, finished_at, status, total_files, safe_bytes, migratable_bytes, highrisk_bytes)
     VALUES('quick','t','t','done', 12, 2048, 4096, 8192)`
  )
  // 一个活跃冷藏项 + 一个已删除（不计入占用）
  db.run(
    `INSERT INTO cold_items(id, original_path, cold_path, size_bytes, migrated_at, state, restorable)
     VALUES('a','/o/a','/c/a', 1000, 't', 'active', 1)`
  )
  db.run(
    `INSERT INTO cold_items(id, original_path, cold_path, size_bytes, migrated_at, state, restorable)
     VALUES('b','/o/b','/c/b', 9999, 't', 'deleted', 0)`
  )
  // 操作记录：成功 + 失败
  db.logOperation({ ts: '2026-01-01T00:00:00Z', op_type: 'clean', path: 'C:\\t\\x', size_bytes: 100, status: 'success' })
  db.logOperation({ ts: '2026-01-02T00:00:00Z', op_type: 'migrate', path: 'C:\\t\\y', status: 'failed', error_code: 'E_CHECKSUM', error_detail: 'mismatch' })
  db.flush()
  return { db, stats: new StatsService(db, new BackupService(db)) }
}

describe('StatsService (real fs + sql.js)', () => {
  it('overview 汇总扫描/冷藏占用/备份盘未设/最近记录', async () => {
    const { stats } = await setup()
    const o = await stats.overview()
    expect(o.scan?.safe_bytes).toBe(2048)
    expect(o.scan?.migratable_bytes).toBe(4096)
    expect(o.cold.count).toBe(1) // 仅 active
    expect(o.cold.bytes).toBe(1000)
    expect(o.backup.set).toBe(false)
    expect(o.recent.length).toBe(2)
    expect(o.system.total).toBeGreaterThan(0) // 真实 C 盘
  })

  it('operations 过滤：failed 仅返回失败项', async () => {
    const { stats } = await setup()
    expect(stats.operations('all').length).toBe(2)
    expect(stats.operations('migrate').length).toBe(1)
    const failed = stats.operations('failed')
    expect(failed.length).toBe(1)
    expect(failed[0].error_code).toBe('E_CHECKSUM')
  })

  it('buildExport：CSV 含表头并转义，JSON 可解析', async () => {
    const { stats } = await setup()
    const csv = stats.buildExport('csv')
    expect(csv.split('\r\n')[0]).toContain('op_type')
    expect(csv).toContain('E_CHECKSUM')
    const json = JSON.parse(stats.buildExport('json'))
    expect(Array.isArray(json)).toBe(true)
    expect(json.length).toBe(2)
  })
})
