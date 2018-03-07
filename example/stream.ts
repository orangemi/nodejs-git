import {PassThrough} from 'stream'
import {readUntil} from '../src/readUntil'

async function main () {
  const p = new PassThrough()
  // setTimeout(() => {
    p.write('1234567890')
    p.write('1234567890')
    p.write('123456\n\n7890')
    p.write('1234567890')
  // }, 1000)
  // p.on('data', (c) => console.log('p.onData: ', c.length))
  const r = await readUntil(p, Buffer.from('\n\n'))
  console.log('---', r.toString())
  const p2 = new PassThrough()
  p.pipe(p2)
  p2.on('data', (c) => console.log('p2.onData: ', c.length))
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})