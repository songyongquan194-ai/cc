import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { BackupService } from '../BackupService'
import { MigrateRunner } from '../MigrateRunner'
import { ColdService } from '../ColdService'
import { coldStorageRoot } from '@core/coldPath'
import { getActiveProfile } from '@core/platform'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

// 备份目标必须非系统盘；工作目录在 G:\AQ，故临时目录建在 G: 上。
let base: string
afterEach(() => {
  if (base && existsSync(base)) rmSync(base, { recursive: true, force: true })
})

async function setup(): Promise<{ db: Db; backupRoot: string; srcDir: string }> {
  base = mkdtempSync(join(process.cwd(), 'itmp-'))
  const backupRoot = join(base, 'backup')
  const srcDir = join(base, 'src')
  mkdirSync(backupRoot, { recursive: true })
  mkdirSync(srcDir, { recursive: true })
  const db = await Db.create(join(base, 'app.db'), locate)
  db.setSetting('backup_drive_path', backupRoot)
  db.setSetting('cold_storage_root', coldStorageRoot(getActiveProfile().path, backupRoot))
  db.setSetting('default_cold_period_days', 90)
  db.flush()
  return { db, backupRoot, srcDir }
}

function insertScan(db: Db): number {
  db.run('INSERT INTO scans(type, started_at, status) VALUES(?,?,?)', ['deep', 'now', 'done'])
  return db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id
}

function insertItem(db: Db, scanId: number, path: string, size: number): void {
  db.run(
    `INSERT INTO scan_items(scan_id, path, size_bytes, category, risk_level, default_action,
       matched_rule, ext, explain_tmpl) VALUES(?,?,?,?,?,?,?,?,?)`,
    [scanId, path, size, 'pkg_installer', 'low', 'migrate', 'r', '.iso', '可重新下载']
  )
}

describe('MigrateRunner (real fs + sql.js)', () => {
  it('迁移：源删除、冷藏存在、cold_items + manifest 双写、operations 记录', async () => {
    const { db, backupRoot, srcDir } = await setup()
    const scanId = insertScan(db)
    const f = join(srcDir, 'setup.iso')
    writeFileSync(f, Buffer.alloc(2048, 7))
    insertItem(db, scanId, f, 2048)
    db.flush()

    const backup = new BackupService(db)
    const runner = new MigrateRunner(db, backup)

    const plan = await runner.plan(scanId)
    expect(plan.backup_set).toBe(true)
    expect(plan.allowed).toBe(true)
    expect(plan.c_freed_bytes).toBe(2048)
    expect(plan.item_count).toBe(1)

    const report = await runner.run(scanId)
    expect(report.migrated).toBe(1)
    expect(report.freed_bytes).toBe(2048)
    expect(existsSync(f)).toBe(false)

    // cold_items 入库
    const cold = new ColdService(db, backup).list()
    expect(cold.length).toBe(1)
    expect(existsSync(cold[0].cold_path)).toBe(true)
    expect(cold[0].restorable).toBe(true)

    // manifest.json 双写
    const manifest = JSON.parse(
      readFileSync(join(coldStorageRoot(getActiveProfile().path, backupRoot), 'manifest.json'), 'utf-8')
    )
    expect(manifest.items.length).toBe(1)
    expect(manifest.items[0].original_path).toBe(f)

    // operations 记录
    const ops = db.query('SELECT * FROM operations WHERE op_type = ?', ['migrate'])
    expect(ops.length).toBe(1)
    expect(ops[0].status).toBe('success')
  })

  it('未设备份盘 → plan 返回 E_NO_BACKUP_DRIVE 不允许', async () => {
    base = mkdtempSync(join(process.cwd(), 'itmp-'))
    const db = await Db.create(join(base, 'app.db'), locate)
    const scanId = insertScan(db)
    insertItem(db, scanId, join(base, 'x.iso'), 100)
    db.flush()
    const runner = new MigrateRunner(db, new BackupService(db))
    const plan = await runner.plan(scanId)
    expect(plan.backup_set).toBe(false)
    expect(plan.allowed).toBe(false)
    expect(plan.error_code).toBe('E_NO_BACKUP_DRIVE')
  })

  it('冷藏区延长周期与永久删除', async () => {
    const { db, srcDir } = await setup()
    const scanId = insertScan(db)
    const f = join(srcDir, 'a.iso')
    writeFileSync(f, Buffer.alloc(512, 1))
    insertItem(db, scanId, f, 512)
    db.flush()
    const backup = new BackupService(db)
    await new MigrateRunner(db, backup).run(scanId)
    const cold = new ColdService(db, backup)
    const id = cold.list()[0].id

    const ext = cold.extend(id, -1)
    expect(ext.ok).toBe(true)
    expect(ext.expires_at).toBeNull()

    const coldPath = cold.list()[0].cold_path
    const del = await cold.deletePermanently(id)
    expect(del.ok).toBe(true)
    expect(existsSync(coldPath)).toBe(false)
    expect(cold.list().length).toBe(0)
  })
})
