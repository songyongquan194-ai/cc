import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { BackupService } from '../BackupService'
import { MigrateRunner } from '../MigrateRunner'
import { ColdService } from '../ColdService'
import { RestoreRunner } from '../RestoreRunner'
import { coldStorageRoot } from '@core/coldPath'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

let base: string
afterEach(() => {
  if (base && existsSync(base)) rmSync(base, { recursive: true, force: true })
})

async function migrateOne(): Promise<{
  db: Db
  backup: BackupService
  srcFile: string
  coldId: string
}> {
  base = mkdtempSync(join(process.cwd(), 'itmp-'))
  const backupRoot = join(base, 'backup')
  const srcDir = join(base, 'src')
  mkdirSync(backupRoot, { recursive: true })
  mkdirSync(srcDir, { recursive: true })
  const db = await Db.create(join(base, 'app.db'), locate)
  db.setSetting('backup_drive_path', backupRoot)
  db.setSetting('cold_storage_root', coldStorageRoot(backupRoot))
  db.setSetting('default_cold_period_days', 90)
  db.run('INSERT INTO scans(type, started_at, status) VALUES(?,?,?)', ['deep', 'now', 'done'])
  const scanId = db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id
  const srcFile = join(srcDir, 'setup.iso')
  writeFileSync(srcFile, Buffer.alloc(1024, 9))
  db.run(
    `INSERT INTO scan_items(scan_id, path, size_bytes, category, risk_level, default_action, matched_rule, ext, explain_tmpl)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [scanId, srcFile, 1024, 'pkg_installer', 'low', 'migrate', 'r', '.iso', '']
  )
  db.flush()
  const backup = new BackupService(db)
  await new MigrateRunner(db, backup).run(scanId)
  const coldId = new ColdService(db, backup).list()[0].id
  return { db, backup, srcFile, coldId }
}

describe('RestoreRunner (real fs + sql.js)', () => {
  it('恢复回原路径：文件重现、cold_items 置 restored、operations 记录', async () => {
    const { db, backup, srcFile, coldId } = await migrateOne()
    expect(existsSync(srcFile)).toBe(false) // 迁移后源已删

    const runner = new RestoreRunner(db, backup)
    const r = await runner.run(coldId, { removeCold: false })
    expect(r.found).toBe(true)
    expect(r.status).toBe('done')
    expect(r.restored_path).toBe(srcFile)
    expect(existsSync(srcFile)).toBe(true)

    // cold_items 状态
    const row = db.query<{ state: string }>('SELECT state FROM cold_items WHERE id = ?', [coldId])[0]
    expect(row.state).toBe('restored')
    // 活跃列表不再包含它
    expect(new ColdService(db, backup).list().length).toBe(0)
    // operations 记录
    const ops = db.query('SELECT * FROM operations WHERE op_type = ?', ['restore'])
    expect(ops.length).toBe(1)
    expect(ops[0].status).toBe('success')
  })

  it('原位置已存在 + 默认取消 → cancelled，源保留冷藏保留', async () => {
    const { db, backup, srcFile, coldId } = await migrateOne()
    writeFileSync(srcFile, Buffer.alloc(10)) // 制造冲突
    const r = await new RestoreRunner(db, backup).run(coldId, { onConflict: 'cancel' })
    expect(r.status).toBe('cancelled')
    expect(r.cold_kept).toBe(true)
    expect(new ColdService(db, backup).list().length).toBe(1) // 仍为 active
  })

  it('removeCold=true：恢复后删除冷藏副本并标记不可再恢复', async () => {
    const { db, backup, srcFile, coldId } = await migrateOne()
    const coldPath = new ColdService(db, backup).list()[0].cold_path
    const r = await new RestoreRunner(db, backup).run(coldId, { removeCold: true })
    expect(r.status).toBe('done')
    expect(existsSync(srcFile)).toBe(true)
    expect(existsSync(coldPath)).toBe(false)
    const row = db.query<{ restorable: number }>('SELECT restorable FROM cold_items WHERE id = ?', [coldId])[0]
    expect(row.restorable).toBe(0)
  })
})
