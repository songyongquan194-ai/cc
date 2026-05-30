import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ColdItem, ColdState } from '@shared/types'

/** 冷藏区 manifest.json，作为 SQLite 之外的可移植真相源（拔盘后仍可读，TECH_DESIGN.md §3.2）。 */
export interface Manifest {
  version: number
  created_at: string
  items: ColdItem[]
}

export function manifestPath(coldRoot: string): string {
  return join(coldRoot, 'manifest.json')
}

export function readManifest(coldRoot: string): Manifest {
  const p = manifestPath(coldRoot)
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Manifest
    } catch {
      // 损坏则不覆盖原文件，返回空集合由调用方决定
    }
  }
  return { version: 1, created_at: new Date().toISOString(), items: [] }
}

export function writeManifest(coldRoot: string, m: Manifest): void {
  if (!existsSync(coldRoot)) mkdirSync(coldRoot, { recursive: true })
  writeFileSync(manifestPath(coldRoot), JSON.stringify(m, null, 2), 'utf-8')
}

export function appendManifestItems(coldRoot: string, items: ColdItem[]): void {
  if (!items.length) return
  const m = readManifest(coldRoot)
  m.items.push(...items)
  writeManifest(coldRoot, m)
}

/** 更新某项状态（恢复/删除时用），找不到则忽略。 */
export function updateManifestState(
  coldRoot: string,
  id: string,
  state: ColdState,
  restorable?: boolean
): void {
  const m = readManifest(coldRoot)
  const it = m.items.find((i) => i.id === id)
  if (!it) return
  it.state = state
  if (restorable !== undefined) it.restorable = restorable
  writeManifest(coldRoot, m)
}
