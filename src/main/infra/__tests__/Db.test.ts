import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../Db'

const require_ = createRequire(import.meta.url)
const locate = (f: string) => require_.resolve(`sql.js/dist/${f}`)

let dir: string
function freshPath(): string {
  dir = mkdtempSync(join(tmpdir(), 'cdc-db-'))
  return join(dir, 'app.db')
}

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
})

describe('Db (sql.js)', () => {
  it('建表并新库立即落盘', async () => {
    const p = freshPath()
    const db = await Db.create(p, locate)
    expect(existsSync(p)).toBe(true)
    db.close()
  })

  it('settings 读写与默认值', async () => {
    const db = await Db.create(freshPath(), locate)
    expect(db.getSetting('missing', 'def')).toBe('def')
    db.setSetting('backup_drive_path', 'D:\\')
    db.setSetting('default_cold_period_days', 90)
    expect(db.getSetting('backup_drive_path', '')).toBe('D:\\')
    expect(db.getSetting('default_cold_period_days', 0)).toBe(90)
    db.close()
  })

  it('日志写入可按类型查询', async () => {
    const db = await Db.create(freshPath(), locate)
    db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'clean',
      path: 'C:\\Users\\Alex\\Temp\\x.tmp',
      size_bytes: 1234,
      status: 'success',
      user_confirm: 'normal'
    })
    const rows = db.query('SELECT * FROM operations WHERE op_type = ?', ['clean'])
    expect(rows.length).toBe(1)
    expect(rows[0].path).toBe('C:\\Users\\Alex\\Temp\\x.tmp')
    expect(rows[0].status).toBe('success')
    db.close()
  })

  it('重新打开后数据持久化', async () => {
    const p = freshPath()
    const db1 = await Db.create(p, locate)
    db1.setSetting('k', 'v1')
    db1.flush()
    db1.close()

    const db2 = await Db.create(p, locate)
    expect(db2.getSetting('k', '')).toBe('v1')
    db2.close()
  })
})
