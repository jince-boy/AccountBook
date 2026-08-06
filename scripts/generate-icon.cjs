const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

async function generate() {
  const source = path.join(process.cwd(), 'public', 'icon.svg')
  const targetDirectory = path.join(process.cwd(), 'build')
  const target = path.join(targetDirectory, 'icon.png')
  const svg = await fs.readFile(source)
  await fs.mkdir(targetDirectory, { recursive: true })
  await sharp(svg).resize(256, 256).png().toFile(target)
}

generate().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
