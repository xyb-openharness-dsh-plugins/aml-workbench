// 本文件由 scripts/build-version.mjs 生成，请勿手改。
// 唯一来源：仓库根目录的 VERSION。改版本先改 VERSION，再跑 npm run build:version。
export const version = '0.6.5'
export const build = '2026-10-28'
export const channel = 'beta'
export const commit = 'a9da1a4'

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
