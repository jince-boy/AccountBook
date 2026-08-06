const fs = require('node:fs')
const path = require('node:path')

const repository = process.env.GITHUB_REPOSITORY || ''
const match = repository.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)

if (!match) {
  throw new Error('GITHUB_REPOSITORY 必须是 owner/repository 格式')
}

const [, owner, repo] = match
const packagePath = path.join(__dirname, '..', 'package.json')
const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

if (process.env.GITHUB_REF_TYPE === 'tag') {
  const tagVersion = (process.env.GITHUB_REF_NAME || '').replace(/^v/, '')
  if (!tagVersion || tagVersion !== metadata.version) {
    throw new Error(`版本标签 ${process.env.GITHUB_REF_NAME || '(空)'} 与 package.json 的 ${metadata.version} 不一致`)
  }
}

metadata.repository = {
  type: 'git',
  url: `https://github.com/${repository}.git`,
}
metadata.build = {
  ...metadata.build,
  extraMetadata: {
    ...(metadata.build?.extraMetadata || {}),
    updateRepository: repository,
  },
  publish: [{
    provider: 'github',
    owner,
    repo,
    releaseType: 'release',
  }],
}

fs.writeFileSync(packagePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
console.log(`已为 ${repository} 写入 CI 发布与客户端更新配置`)
