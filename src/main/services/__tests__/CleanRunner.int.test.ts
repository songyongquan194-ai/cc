import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { CleanRunner } from '../CleanRunner'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

let dir: string
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
})

async function setup(): Promise<{ db: Db; root: string }> {
  dir = mkdtempSync(join(tmpdir(), 'cdc-clean-'))
  const db = await Db.create(join(dir, 'app.db'), locate)
  return { db, root: dir }
}

function insertItem(
  db: Db,
  scanId: number,
  path: string,
  size: number,
  risk = 'safe',
  action = 'clean'
): void {
  db.run(
    `INSERT INTO scan_items(scan_id, path, size_bytes, category, risk_level, default_action,
       matched_rule, ext, explain_tmpl) VALUES(?,?,?,?,?,?,?,?,?)`,
    [scanId, path, size, 'sys_temp', risk, action, 'r', '.tmp', '']
  )
}

describe('CleanRunner (real fs + sql.js)', () => {
  it('清理选中安全项并写 operations 日志', async () => {
    const { db, root } = await setup()
    db.run('INSERT INTO scans(type, started_at, status) VALUES(?,?,?)', ['quick', 'now', 'done'])
    const scanId = db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id

    const a = join(root, 'a.tmp')
    const b = join(root, 'b.tmp')
    writeFileSync(a, 'x'.repeat(100))
    writeFileSync(b, 'y'.repeat(200))
    insertItem(db, scanId, a, 100)
    insertItem(db, scanId, b, 200)
    db.flush()

    const runner = new CleanRunner(db)
    const report = await runner.run({ scanId, paths: [a, b] })

    expect(report.cleaned).toBe(2)
    expect(report.freed_bytes).toBe(300)
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(false)

    const logs = db.query('SELECT * FROM operations WHERE op_type = ?', ['clean'])
    expect(logs.length).toBe(2)
    expect(logs.every((l) => l.user_confirm === 'normal' && l.status === 'success')).toBe(true)
  })

  it('preview 只返回 safe/low 且 clean 的项', async () => {
    const { db, root } = await setup()
    db.run('INSERT INTO scans(type, started_at, status) VALUES(?,?,?)', ['quick', 'now', 'done'])
    const scanId = db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id

    insertItem(db, scanId, join(root, 'safe.tmp'), 10, 'safe', 'clean')
    insertItem(db, scanId, join(root, 'high.tmp'), 10, 'high', 'clean')
    insertItem(db, scanId, join(root, 'migrate.iso'), 10, 'low', 'migrate')
    db.flush()

    const runner = new CleanRunner(db)
    const preview = runner.preview(scanId)
    expect(preview.length).toBe(1)
    expect(preview[0].path.endsWith('safe.tmp')).toBe(true)
  })
})
