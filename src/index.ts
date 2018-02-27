import * as fs from 'mz/fs'
import * as limitFactory from 'promise-limit'
import * as zlib from 'zlib'
import * as path from 'path'
import { PassThrough, Transform, Readable } from 'stream'

interface LoadOptions {
  loadAll?: Boolean,
}

interface LoadResult {
  type: string,
  hash: hash,
  length: number,
  stream: Readable,
  buffer?: Buffer,
}

interface CommitResult {
  type: string,
  hash: hash,
  tree: string,
  committer: Author,
  author: Author,
  message: string,
  parent: Array<string>,
}

interface Author {
  name: string,
  email: string,
  emails?: Array<string>,
  date: Date,
  timezone?: string,
}

interface TreeResult extends LoadResult {
  nodes?: Array<TreeNode>,
}

interface TreeNode {
  mode: number,
  name: string,
  hash: hash,
}

type hash = string
type HashMap = {[key: string]: hash}

export class Repo {
  repoPath: string
  constructor (repoPath: string) {
    this.repoPath = repoPath
  }

  async listBranches () {
    const prefix = 'refs/heads'
    const hashMap = await this.listRefs(prefix)
    const result: HashMap = {}
    Object.keys(hashMap).forEach(key => result[key.substring(prefix.length + 1)] = hashMap[key])
    return result
  }

  async listTags () {
    const prefix = 'refs/tags'
    const hashMap = await this.listRefs(prefix)
    const result: HashMap = {}
    Object.keys(hashMap).forEach(key => result[key.substring(prefix.length + 1)] = hashMap[key])
    return result
  }

  async listRefs (prefix: string = 'refs/heads') {
    return listDeepFileList(this.repoPath, prefix)
  }

  async loadBlob (hash: hash, options: LoadOptions = {}) {
    return this.loadObject(hash, options)
  }

  async loadCommit (hash: hash, options: LoadOptions = {}): Promise<CommitResult> {
    if (!isHash(hash)) return this.loadRef(hash, options)
    const loadResult = await this.loadObject(hash, {loadAll: true})
    if (loadResult.type !== 'commit') throw new Error(hash + ' is not commit')
    let buffer = loadResult.buffer
    const result: CommitResult = {
      type: 'commit',
      hash: hash,
      tree: null,
      committer: null,
      author: null,
      message: '',
      parent: []
    }
    while (buffer[0] !== 0x0a) {
      const spaceIndex = buffer.indexOf(0x20)
      const lfIndex = buffer.indexOf(0x0a)
      const key = buffer.slice(0, spaceIndex).toString()
      const value = buffer.slice(spaceIndex + 1, lfIndex).toString()
      switch (key) {
        case 'tree': result.tree = value; break
        case 'parent': result.parent.push(value); break
        case 'author': result.author = parseAuthor(value); break
        case 'committer': result.committer = parseAuthor(value); break
      }
      buffer = buffer.slice(lfIndex + 1)
    }
    result.message = buffer.slice(1).toString()
    return result
  }

  async loadTree (hash: hash, options: LoadOptions = {}) {
    if (!isHash(hash)) throw new Error(hash + ' is not hash')
    const loadResult = await this.loadObject(hash)
    if (loadResult.type !== 'tree') throw new Error(hash + ' is not tree')
    let left = Buffer.alloc(0)
    const transform = new Transform({
      // writableObjectMode: true,
      readableObjectMode: true,
      transform: (chunk: Buffer, encoding: string, callback: Function) => {
        left = Buffer.concat([left, chunk])
        while (true) {
          const spaceIndex = left.indexOf(0x20)
          const nilIndex = left.indexOf(0x00)
          if (nilIndex === -1 || left.length - nilIndex < 20) break
          const filemode = bufferGetOct(left, 0, spaceIndex)
          const filename = left.slice(spaceIndex + 1, nilIndex).toString()
          const sha = left.slice(nilIndex + 1, nilIndex + 21).toString('hex')
          transform.push(<TreeNode>{
            mode: filemode,
            name: filename,
            hash: sha,
          })

          left = left.slice(nilIndex + 21)
        }
        callback()
      }
    })
    const sourceStream = loadResult.stream
    sourceStream.pipe(transform)

    const result: TreeResult = loadResult
    result.stream = transform

    if (options.loadAll) {
      result.nodes = []
      transform.on('data', (node: TreeNode) => {
        result.nodes.push(node)
      })
      await new Promise(resolve => transform.on('end', resolve))
    }
    return result
  }

  async loadBranch (branch: string) {
    return this.loadRef('refs/heads/' + branch)
  }

  async loadTag (tag: string) {
    return this.loadRef('refs/tags/' + tag)
  }

  async loadRef (hash: hash, options: LoadOptions = {}): Promise<CommitResult> {
    const objectPath = path.resolve(this.repoPath, hash)
    const content = await fs.readFile(objectPath, {encoding: 'utf8'})

    if (hash === 'HEAD') {
      if (!REF_REGEX.test(content)) throw new Error('HEAD file corrept')
      const ref = REF_REGEX.exec(content)[1]
      return this.loadRef(ref.trim(), options)
    } else {
      if (!isHash(content.trim())) throw new Error(content + 'is not hash')
      return this.loadCommit(content.trim(), options)
    }
  }

  async loadObject (hash: hash, options: LoadOptions = {}) {
    if (!isHash(hash)) throw new Error(hash + ' is not hash')
    const objectPath = path.resolve(this.repoPath, 'objects', hash.substring(0, 2), hash.substring(2))
    const contentStream = zlib.createInflate()
    const fileStream = fs.createReadStream(objectPath)
    fileStream.pipe(contentStream)
    let chunk = await readOnce(contentStream)
    while (!~chunk.indexOf(0x00)) {
      const newChunk = await readOnce(contentStream)
      if (!newChunk) throw new Error('not find 0x00')
      chunk = Buffer.concat([chunk, newChunk])
    }

    const spaceIndex = chunk.indexOf(0x20)
    const type = bufferGetAscii(chunk, 0, spaceIndex)

    const nilIndex = chunk.indexOf(0x00, spaceIndex)
    const length = bufferGetDecimal(chunk, spaceIndex + 1, nilIndex)

    const left = chunk.slice(nilIndex + 1)
    const streaming = new PassThrough()
    streaming.write(left)
    contentStream.pipe(streaming)

    const result: LoadResult = {
      type: type,
      hash: hash,
      length: length,
      stream: streaming,
    }

    if (options.loadAll) {
      result.buffer = Buffer.alloc(0)
      streaming.on('data', (chunk: Buffer) => {
        result.buffer = Buffer.concat([result.buffer, chunk])
      })
      await new Promise(resolve => streaming.on('end', resolve))
    }

    return result
  }
  // }
}

function readOnce (contentStream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!contentStream.readable) return resolve(null)
    function onRead (chunk: Buffer) {
      contentStream.removeListener('error', onError)
      resolve(chunk)
    }
    function onError (err: Error) {
      contentStream.removeListener('data', onRead)
      reject(err)
    }
    contentStream.once('data', onRead)
    contentStream.once('error', onError)
  })
}

function bufferGetAscii (buffer: Buffer, start, end: number) {
  let string = ''
  for (let i = start; i < end; i++) {
    string += String.fromCharCode(buffer[i])
  }
  return string
}

function bufferGetOct (buffer: Buffer, start, end: number) {
  let number = 0
  for (let i = start; i < end; i++) {
    number = (number << 3) + buffer[start++] - 0x30;
  }
  return number
}

function bufferGetDecimal (buffer: Buffer, start, end: number) {
  let number = 0
  for (let i = start; i < end; i++) {
    number = number * 10 + buffer[i] - 0x30
  }
  return number
}

const REF_REGEX = /^ref: *(.*)/
const HASH_REGEX = /^[0-9a-f]{40}$/
function isHash (string: string) {
  return HASH_REGEX.test(string)
}

function parseAuthor (string: string) {
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

async function listDeepFileList (root: string, prefix: string): Promise<HashMap> {
  const files = await fs.readdir(path.resolve(root, prefix))
  files.filter(file => /^\./.test(file))
  const limiter = limitFactory(5)
  const hashMaps: Array<HashMap> = await Promise.all(files.map(file => limiter(async () => {
    const result: HashMap = {}
    file = prefix + '/' + file
    const fsStat = await fs.stat(path.resolve(root, file))
    if (fsStat.isFile() && fsStat.size >= 40 && fsStat.size <= 41) {
      const content = await fs.readFile(path.resolve(root, file))
      const hash = content.toString().trim()
      return <HashMap>{[file]: hash}
    }
    if (fsStat.isDirectory()) return listDeepFileList(root, file)
    throw new Error('unknown ref ' + file)
  })))
  const result: HashMap = {}
  hashMaps.forEach(hashMap => Object.assign(result, hashMap)) // files.forEach(file => result.push(file)))
  return result
}