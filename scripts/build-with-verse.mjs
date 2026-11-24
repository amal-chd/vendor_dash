import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const verseDir = process.env.KADA_VERSE_APP_DIR
  ? resolve(process.env.KADA_VERSE_APP_DIR)
  : [
      join(root, '../../Mobile Apps/kada_verse_app'),
      join(root, 'kada_verse_app'),
      join(root, '../kada_verse_app'),
    ].find((directory) => existsSync(join(directory, 'pubspec.yaml')))
const requireVerse = process.argv.includes('--require-verse') || Boolean(process.env.KADA_VERSE_APP_DIR)

if (!verseDir && requireVerse) {
  throw new Error('Kada Verse app source is missing. Set KADA_VERSE_APP_DIR to its Flutter project directory.')
}
if (verseDir && !existsSync(join(verseDir, 'pubspec.yaml'))) {
  throw new Error(`Kada Verse app source is missing a pubspec.yaml at ${verseDir}`)
}

const publicPath = '/verse-app/'
const env = { ...process.env, VITE_KADA_VERSE_WORKSPACE: verseDir ? 'true' : 'false' }
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (verseDir) {
  const flutter = process.env.KADA_FLUTTER_BIN || 'flutter'
  // Shared by both apps. Only forward the public Firebase Web SDK configuration.
  const { loadEnv } = await import('vite')
  const firebase = { ...loadEnv('production', root, 'VITE_FIREBASE_'), ...process.env }
  const webDefines = [
    ['KADA_FIREBASE_API_KEY', 'VITE_FIREBASE_API_KEY'],
    ['KADA_FIREBASE_WEB_APP_ID', 'VITE_FIREBASE_APP_ID'],
    ['KADA_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_PROJECT_ID'],
    ['KADA_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_STORAGE_BUCKET'],
    ['KADA_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_AUTH_DOMAIN'],
    ['KADA_FIREBASE_SENDER_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID'],
  ].flatMap(([define, key]) => firebase[key] ? [`--dart-define=${define}=${firebase[key]}`] : [])

  const pubOptions = process.env.KADA_FLUTTER_OFFLINE === '1' ? ['--offline'] : []
  run(flutter, ['pub', 'get', ...pubOptions], verseDir)
  run(flutter, ['build', 'web', '--no-pub', '--base-href', publicPath, '--no-web-resources-cdn', '--pwa-strategy=none', ...webDefines], verseDir)
}

run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], root)

if (verseDir) {
  const buildDir = join(verseDir, 'build/web')
  const index = readFileSync(join(buildDir, 'index.html'), 'utf8')
  if (!index.includes(`<base href="${publicPath}">`)) throw new Error('Kada Verse build has the wrong base path.')
  cpSync(buildDir, join(root, 'dist', publicPath), { recursive: true })
}
