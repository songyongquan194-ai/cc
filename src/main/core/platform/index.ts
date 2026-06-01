// 平台档选择器。生产按 process.platform 选档；测试可用 setProfileForTesting 注入。
import type { PlatformProfile } from './Profile'
import { windowsProfile } from './windows'
import { macProfile } from './mac'

export type { PlatformProfile, PlatformPath } from './Profile'
export { windowsProfile } from './windows'
export { macProfile } from './mac'

let override: PlatformProfile | null = null

/** 仅供测试：固定使用某个平台档；传 null 还原为按平台自动选择。 */
export function setProfileForTesting(p: PlatformProfile | null): void {
  override = p
}

/** 当前生效平台档（darwin → mac，其余 → windows）。 */
export function getActiveProfile(): PlatformProfile {
  if (override) return override
  return process.platform === 'darwin' ? macProfile : windowsProfile
}
