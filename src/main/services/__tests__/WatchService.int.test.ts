import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync, writeFileSync, unlinkSync, utimesSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { WatchService } from '../WatchService'
import { DuplicateService } from '../DuplicateService'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

let base: string
afterEach(() => {
  if (base && existsSync(base)) rmSync(base, { recursive: true, force: true })
})

async function mkDb(): Promise<Db> {
  base = mkdtempSync(join(process.cwd(), 'itmp-'))
  return Db.create(join(base, 'app.db'), locate)
}

describe('WatchService (real fs + sql.js)', () => {
  it('add 去重同路径；list 返回记录', async () => {
    const db = await mkDb()
    const w = new WatchService(db)
    const file = join(base, 'a.bin')
    writeFileSync(file, 'x')
    const r1 = await w.add({ path: file, size_bytes: 1, periodDays: 30 })
    const r2 = await w.add({ path: file, size_bytes: 1, periodDays: 7 })
    expect(r1.id).toBe(r2.id) // 同路径不重复插入
    const list = w.list()
    expect(list.length).toBe(1)
    expect(list[0].period_days).toBe(7) // 周期被刷新
  })

  it('check：文件消失→missing，不报错', async () => {
    const db = await mkDb()
    const w = new WatchService(db)
    const file = join(base, 'gone.bin')
    writeFileSync(file, 'x')
    await w.add({ path: file, periodDays: 30 })
    unlinkSync(file)
    const after = await w.check()
    expect(after[0].status).toBe('missing')
  })

  it('check：过期未变更→due；dueCount 计数', async () => {
    const db = await mkDb()
    const w = new WatchService(db)
    const file = join(base, 'keep.bin')
    writeFileSync(file, 'x')
    await w.add({ path: file, periodDays: 30 })
    // 手动把提醒时间设为过去
    db.run('UPDATE watch_items SET remind_at = ?', ['2000-01-01T00:00:00Z'])
    const after = await w.check()
    expect(after[0].status).toBe('due')
    expect(w.dueCount()).toBe(1)
  })

  it('extend 重置提醒、ignore/remove 生效', async () => {
    const db = await mkDb()
    const w = new WatchService(db)
    const file = join(base, 'k.bin')
    writeFileSync(file, 'x')
    const { id } = await w.add({ path: file, periodDays: 30 })
    db.run('UPDATE watch_items SET remind_at = ?', ['2000-01-01T00:00:00Z'])
    w.extend(id, 60)
    expect((await w.check())[0].status).toBe('watching') // 未来提醒时间
    w.ignore(id)
    expect(w.list()[0].status).toBe('ignored')
    w.remove(id)
    expect(w.list().length).toBe(0)
  })
})

describe('DuplicateService (real sql.js)', () => {
  it('从 scan_items 分组同名同大小候选', async () => {
    const db = await mkDb()
    db.run('INSERT INTO scans(type, started_at, status) VALUES(?,?,?)', ['quick', 't', 'done'])
    const scanId = db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id
    const ins = (p: string, size: number): void =>
      db.run(
        `INSERT INTO scan_items(scan_id, path, size_bytes, category, risk_level, default_action)
         VALUES(?,?,?,?,?,?)`,
        [scanId, p, size, 'uncategorized', 'low', 'none']
      )
    const MB = 1024 * 1024
    ins('C:\\Users\\A\\Documents\\报告.pdf', 3 * MB)
    ins('C:\\Users\\A\\Downloads\\报告 - 副本.pdf', 3 * MB)
    ins('C:\\Users\\A\\Downloads\\其它.bin', 5 * MB)
    db.flush()

    const res = new DuplicateService(db).groups(scanId)
    expect(res.group_count).toBe(1)
    expect(res.groups[0].suggested_keep).toContain('Documents')
    expect(res.total_reclaimable).toBe(3 * MB)
  })
})
