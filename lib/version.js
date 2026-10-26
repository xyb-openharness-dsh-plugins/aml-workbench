// 本文件由 scripts/build-version.mjs 生成，请勿手改。
// 唯一来源：仓库根目录的 VERSION。改版本先改 VERSION，再跑 npm run build:version。
export const version = '0.3.2'
export const build = '2026-10-26'
export const channel = 'beta'
export const commit = '39f7b3b'

export const displayVersion = `v${version}`
export const channelLabel = '测试版 · 数据仅在本机'

export const APP_INFO = Object.freeze({
  version,
  displayVersion,
  build,
  channel,
  channelLabel,
  commit,
})
