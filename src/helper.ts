import * as path from 'path'
import * as fs from 'mz/fs'
import * as limitFactory from 'promise-limit'
import { PassThrough, Transform, Readable } from 'stream'
import { hash, LoadOptions, LoadResult, DiffResult, TreeNode, TreeResult, CommitResult, Author } from './ref'
import { readUntil, readLimit, readSkip } from './streamUtil'

const HASH_REGEX = /^[0-9a-fA-F]{40}$/

export function getPackTypeByBit (bit: number) {
  switch (bit) {
    case 1: return 'commit'
    case 2: return 'tree'
    case 3: return 'blob'
    case 4: return 'tag'
    case 6: return 'ofs_delta'
    case 7: return 'ref_delta'
    default: throw new Error('unknown bit type ' + bit)
  }
}

export function bufferGetAscii (buffer: Buffer, start, end: number) {
  let string = ''
  for (let i = start; i < end; i++) {
    string += String.fromCharCode(buffer[i])
  }
  return string
}

export function bufferGetOct (buffer: Buffer, start, end: number) {
  let number = 0
  for (let i = start; i < end; i++) {
    number = (number << 3) + buffer[start++] - 0x30;
  }
  return number
}

export function bufferGetDecimal (buffer: Buffer) {
  let number = 0
  for (let i = 0; i < buffer.length; i++) {
    number = number * 10 + buffer[i] - 0x30
  }
  return number
}

export function isHash (string: string) {
  return HASH_REGEX.test(string)
}

export function parseAuthor (string: string) {
  const ltIndex = string.indexOf(' <')
  const rtIndex = string.indexOf('> ', ltIndex + 2)
  const spaceIndex = string.indexOf(' ', rtIndex + 2)
  const result: Author = {
    name: string.substring(0, ltIndex),
    email: string.substring(ltIndex + 2, rtIndex),
    date: new Date(1000 * parseInt(string.substring(rtIndex + 2, spaceIndex))),
    timezone: string.substring(spaceIndex + 1),
  }
  return result
}

export async function canAccess(filepath) {
  try {
    await fs.access(filepath)
    return true
  } catch (e) {
    return false
  }
}

export async function mkdirp (filepath: string) {
  filepath = path.resolve(filepath)
  const parentPath = path.resolve(filepath, '../')
  
  if (await canAccess(filepath)) return
  if (!await canAccess(parentPath)) {
    await mkdirp(parentPath)
  }
  await fs.mkdir(filepath)
}

export async function listDeepFileList (root: string, prefix: string): Promise<Array<string>> {
  const files = await fs.readdir(path.resolve(root, prefix))
  files.filter(file => /^\./.test(file))
  const limiter = limitFactory<Array<string>>(5)
  const refss: Array<Array<string>> = await Promise.all(files.map(file => limiter(async () => {
    file = prefix + '/' + file
    const fsStat = await fs.stat(path.resolve(root, file))
    if (fsStat.isFile() && fsStat.size >= 40 && fsStat.size <= 41) {
      const content = await fs.readFile(path.resolve(root, file))
      const hash = content.toString().trim()
      return [file]
    }
    if (fsStat.isDirectory()) return listDeepFileList(root, file)
    throw new Error('unknown ref ' + file)
  })))
  const result: Array<string> = []
  refss.forEach(refs => refs.forEach(ref => result.push(ref)))
  return result
}

export function findAndPop (source: TreeNode, nodes: Array<TreeNode>): TreeNode {
  const index = nodes.findIndex(node => node.name === source.name)
  if (index >= 0) return nodes.splice(index, 1)[0]
}

export async function parseVInt (stream: Readable, firstByte: number, firstSkipBit: number = 1): Promise<number> {
  // console.log('parseVInt', firstByte.toString(2))
  let metaLength = 0
  let fileLength = firstByte & (Math.pow(2, (8 - firstSkipBit)) - 1)
  // console.log('parseVInt1', fileLength)
  if (!(firstByte >> 7)) return fileLength
  while (true) {
    const byteBuffer = await readLimit(stream, 1)
    const byte = byteBuffer[0]
    const bitOffset = (8 - firstSkipBit) % 8 + 7 * (metaLength++)
    fileLength += (byte & 0x7f) << bitOffset
    // console.log('parseVInt2', fileLength, byteBuffer, byte.toString(2), bitOffset)
    if (!(byte >> 7)) break
  }
  return fileLength
}

export async function parseVInt2 (stream: Readable): Promise<number> {
  let metaLength = 0
  let fileLength = 0
  while (true) {
    const byteBuffer = await readLimit(stream, 1)
    const byte = byteBuffer[0]
    fileLength = (fileLength << 7) + (byte & 0x7f)
    metaLength++
    if (!(byte >> 7)) break
  }
  for (let i = 1; i < metaLength; i++) fileLength += Math.pow(2, 7 * i)
  return fileLength
}

export async function mergeDeltaResult (delta: Readable, getSourceResult: () => Promise<LoadResult>) {
  const targetLength = await readDeltaHead(delta)
  const sourceResult = await getSourceResult()
  let isReading = false
  let sourceRead = 0
  let sourceStream = sourceResult.stream

  async function getSourceStream (force = false) {
    if (force && sourceStream) {
      sourceStream.destroy()
      sourceStream = null
    }
    if (!sourceStream) {
      const loadResult = await getSourceResult()
      sourceStream = loadResult.stream
    }
    return sourceStream
  }

  const targetStream = new Readable({
    async read() {
      if (isReading) return
      isReading = true
      let canPush = true

      while (true) {
        const buffer = await readLimit(delta, 1)
        if (!buffer.length) {
          this.push(null)
          break
        }

        const MSB = buffer[0] >> 7
        if (MSB) {
          // copy
          const offset = await readDeltaLength(delta, buffer[0], 0, 4)
          const length = await readDeltaLength(delta, buffer[0], 4, 7)
          let source = await getSourceStream()
          if (offset < sourceRead) {
            source = await getSourceStream(true)
            sourceRead = 0
          }
          const data = await readLimit(source, length, {skip: offset - sourceRead})
          canPush = this.push(data)
          sourceRead = offset + length
        } else {
          // insert
          let length = buffer[0]
          const data = await readLimit(delta, length)
          canPush = this.push(data)
        }
        if (!canPush) break
      }
      isReading = false
    }
  })

  return <LoadResult>{
    hash: sourceResult.hash,
    type: sourceResult.type,
    length: targetLength,
    stream: targetStream,
  }
}

async function readDeltaHead(delta: Readable) {
  const firstByteBuffer1 = await readLimit(delta, 1)
  const sourceLength = await parseVInt(delta, firstByteBuffer1[0])
  const firstByteBuffer2 = await readLimit(delta, 1)
  const targetLength = await parseVInt(delta, firstByteBuffer2[0])
  return targetLength
}

async function readDeltaLength(delta: Readable, byte0: number, start: number, end: number) {
  let offset = 0
  for (let bit = start; bit < end; bit++) {
    if (byte0 & (1 << bit)) {
      const b = await readLimit(delta, 1)
      offset = offset | (b[0] << (8 * bit))
    }
  }
  return offset
}