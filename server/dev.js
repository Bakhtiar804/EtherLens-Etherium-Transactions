import { spawn } from 'node:child_process'
// One command starts both processes; Vite has a fixed development API target.
const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit' }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  children.forEach(child => child.kill())
  process.exitCode = code
}
children.forEach(child => { child.on('error', error => { console.error(error.message); stop(1) }); child.on('exit', code => stop(code || 0)) })
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
