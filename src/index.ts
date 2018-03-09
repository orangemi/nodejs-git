import * as fs from 'mz/fs'
import * as limitFactory from 'promise-limit'
import * as zlib from 'zlib'
import * as path from 'path'
import { PassThrough, Transform, Readable } from 'stream'
import { readUntil, readLimit, readSkip } from './streamUtil'

const NIL = 0x00
const LF = 0x0a
const SPACE = 0x20
const FILE_MODE = {
  FILE: 0x8000,
  DIR: 0x4000
}

const PACK_IDX_2_FANOUT0 = 0xff744f63

export interface DiffResult {
  // left: TreeNode,
  // right: TreeNode,
  path: string,
  leftMode: number,
  rightMode: number,
  leftHash: string,
  rightHash: string,
}

export interface LoadOptions {
  loadAll?: Boolean,
}

export interface LoadResult {
  type: string,
  hash: hash,
  length: number,
  stream: Readable,
  buffer?: Buffer,
}

export interface CommitResult {
  type: string,
  hash: hash,
  tree: string,
  committer: Author,
  author: Author,
  message: string,
  parent: Array<string>,
}

export interface Author {
  name: string,
  email: string,
  emails?: Array<string>,
  date: Date,
  timezone?: string,
}

export interface TreeResult extends LoadResult {
  nodes?: Array<TreeNode>,
}

export interface TreeNode {
  mode: number,
  name: string,
  hash: hash,
}

export type hash = string

export class Repo {
  repoPath: string
  constructor (repoPath: string) {
    this.repoPath = repoPath
  }

  async listBranches () {
    const prefix = 'refs/heads'
    const refs = await this.listRefs(prefix)
    return refs.map(ref => ref.substring(prefix.length + 1))
  }

  async listTags () {
    const prefix = 'refs/tags'
    const refs = await this.listRefs(prefix)
    return refs.map(ref => ref.substring(prefix.length + 1))
  }

  async listRefs (prefix: string = 'refs/heads') {
    return listDeepFileList(this.repoPath, prefix)
  }

  async diffTree (hash1: hash, hash2: hash, options = {recursive: true, prefix: ''}) {
    const prefix = options.prefix || ''
    let result: Array<DiffResult> = []
    let nodes1: Array<TreeNode> = []
    let nodes2: Array<TreeNode> = []
    if (hash1) {
      const tree = await this.loadTree(hash1, {loadAll: true})
      nodes1 = nodes1.concat(tree.nodes)
    }
    if (hash2) {
      const tree = await this.loadTree(hash2, {loadAll: true})
      nodes2 = nodes2.concat(tree.nodes)
    }
  
    await Promise.all(nodes1.map(async (node1) => {
      const node2 = findAndPop(node1, nodes2)
      const diff = <DiffResult>{
        path: prefix + node1.name,
        leftMode: node1.mode,
        leftHash: node1.hash,
        rightMode: node2 ? node2.mode : 0,
        rightHash: node2 ? node2.hash : ''
      }
      // if (!diff.right) diff.right = <TreeNode>{mode: 0, hash: '', name: ''}
      if (diff.leftHash === diff.rightHash) return // ignore same hash
  
      result.push(diff)
      if (options.recursive) {
        let leftHash = diff.leftHash
        let rightHash = diff.rightHash
        if (!(diff.leftMode & FILE_MODE.DIR)) leftHash = ''
        if (!(diff.rightMode & FILE_MODE.DIR)) rightHash = ''
        if (diff.leftMode & FILE_MODE.DIR) { diff.leftMode = 0; diff.leftHash = ''}
        if (diff.rightMode & FILE_MODE.DIR) { diff.rightMode = 0; diff.rightHash = ''}
        if (!(diff.leftMode & FILE_MODE.FILE) && !(diff.rightMode & FILE_MODE.FILE)) result.pop()
        if (leftHash || rightHash) {
          const subDiffs = await this.diffTree(leftHash, rightHash, Object.assign({}, options, {prefix: diff.path + '/'}))
          result = result.concat(subDiffs)
        }
      }
    }))
  
    await Promise.all(nodes2.map(async (node) => {
      const diff = <DiffResult>{
        path: prefix + node.name,
        leftMode: 0,
        leftHash: '',
        rightMode: node.mode,
        rightHash: node.hash,
      }
      if (options.recursive && (node.mode & FILE_MODE.DIR)) {
        const subDiffs = await this.diffTree('', node.hash, Object.assign({}, options, {prefix: diff.path + '/'}))
        result = result.concat(subDiffs)
      } else {
        result.push(diff)
      }
    }))
  
    return result
  }

  async loadBlob (hash: hash, options: LoadOptions = {}) {
    return this.loadObject(hash, options)
  }

  async loadCommit (hash: hash, options: LoadOptions = {}): Promise<CommitResult> {
    if (!isHash(hash)) throw new Error('hash is not hash')
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

    while (buffer[0] !== LF) {
      const spaceIndex = buffer.indexOf(SPACE)
      const lfIndex = buffer.indexOf(LF)
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
      readableObjectMode: true,
      transform: (chunk: Buffer, encoding: string, callback: Function) => {
        left = Buffer.concat([left, chunk])
        while (true) {
          const spaceIndex = left.indexOf(SPACE)
          const nilIndex = left.indexOf(NIL)
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
    const hash = await this.loadFileHash('refs/heads/' + branch)
    return this.loadCommit(hash)
  }

  async loadHead (options?: LoadOptions) {
    const ref = await this.loadRef('HEAD')
    const hash = await this.loadFileHash(ref)
    return this.loadCommit(hash, options)
  }

  async loadRef (filepath: string): Promise<hash> {
    const objectPath = path.resolve(this.repoPath, filepath)
    const content = await fs.readFile(objectPath, {encoding: 'utf8'})
    const ref = REF_REGEX.exec(content)[1]
    return ref.trim()
  }

  async loadTag (tag: string) {
    const hash = await this.loadFileHash('refs/tags/' + tag)
    const loadResult = await this.loadObject(hash, {loadAll: true})
    // console.log('----', loadResult.buffer.toString())
    // TODO: add TagResult Output
  }

  async loadFileHash (filepath: string): Promise<hash> {
    const objectPath = path.resolve(this.repoPath, filepath)
    const content = await fs.readFile(objectPath, {encoding: 'utf8'})
    if (!isHash(content.trim())) throw new Error('content is not hash')
    return content.trim()
  }

  async listPack () {
    const packDirPath = path.resolve(this.repoPath, 'objects', 'pack')
    const files = await fs.readdir(packDirPath)
    return files
      .filter(file => /^pack-([a-f0-9]{40})\.idx$/.test(file))
      .map(file => /^pack-([a-f0-9]{40})\.idx$/.exec(file)[1])
  }

  async findObjectInAllPack (hash: hash, options?: LoadOptions) {
    const packs = await this.listPack()
    const results = await Promise.all(packs.map(pack => this.findObjectInPack(hash, pack)))
    const result = results.filter(result => result)[0]
    return result
  }

  async findObjectInPack (hash: hash, packHash: hash) {
    const hashBuffer = Buffer.from(hash, 'hex')
    const hashFanIdx = hashBuffer.readUIntBE(0, 1)
    const idxFilepath = path.resolve(this.repoPath, 'objects', 'pack', `pack-${packHash}.idx`)
    // const contentStream = zlib.createInflate()
    const idxStream = fs.createReadStream(idxFilepath)
    const idxBuffer = await fs.readFile(idxFilepath)

    // buffer mode
    let offset = 0
    let skip = 0
    // let offset2 = 0
    const headBuffer = await readLimit(idxStream, 256 * 4 + 8)
    if (headBuffer.readUIntBE(0, 4) === PACK_IDX_2_FANOUT0, headBuffer.readUIntBE(4, 4) === 2) offset += 8
    else idxStream.unshift(headBuffer.slice(offset + 255 * 4))
    const totalObjects = headBuffer.readUIntBE(offset + 255 * 4, 4)
    const fanoutStart = hashFanIdx > 0 ? headBuffer.readUIntBE(offset + (hashFanIdx - 1) * 4, 4) : 0
    const fanoutEnd = headBuffer.readUIntBE(offset + hashFanIdx * 4, 4)
    // offset += 1024
    skip = fanoutStart * 20
    let tmpBuffer = await readUntil(idxStream, hashBuffer, {limit: 0, skip: skip})
    const idx = fanoutStart + tmpBuffer.length / 20
    if (idx < 0) {
      idxStream.destroy()
      return null
    }

    // left object hash bytes = (totalObjects - idx - 1) * 20
    // crc32 bytes = totalObjects * 4
    // offset bytes = idx * 4
    skip = (totalObjects - idx - 1) * 20 + totalObjects * 4 + idx * 4
    const packOffsetBuffer = await readLimit(idxStream, 4, {skip})
    const packOffset = packOffsetBuffer.readUIntBE(0, 4)
    // entry?

    // console.log({hash, fanoutStart, fanoutEnd, idx, packOffset, totalObjects})
    idxStream.destroy()
    return this.findObjectInPackfile(hash, packHash, packOffset)
  }

  async findObjectInPackfile (hash: hash, packHash: hash, packOffset: number) {
    const packFilepath = path.resolve(this.repoPath, 'objects', 'pack', `pack-${packHash}.pack`)
    const packStream = fs.createReadStream(packFilepath)
    const packHeaderBuffer = await readLimit(packStream, 12)
    const packFileVersion = packHeaderBuffer.readUIntBE(4, 4)
    const packObjects = packHeaderBuffer.readUIntBE(8, 4)
    // console.log({packHeaderBuffer, packFileVersion, packObjects})

    let skip = packOffset - 12
    let tmpBuffer = await readLimit(packStream, 50, {skip: skip})
    const firstByte = tmpBuffer[0]
    const packDataType = getPackTypeByBit((firstByte & 0x70) >> 4)

    let {metaLength, fileLength} = getMSBLength(tmpBuffer, 4)

    // console.log({packDataType, metaLength, fileLength, typeBit}, tmpBuffer.slice(0, metaLength))
    let refHash = ''
    let ofsOffset = 0
    let sourceLoadResult: LoadResult
    if (packDataType === 'ref_delta') {
      refHash = tmpBuffer.slice(metaLength, metaLength + 20).toString('hex')
      metaLength += 20
      sourceLoadResult = await this.loadObject(refHash)
    } else if (packDataType === 'ofs_delta') {
      let {metaLength: metaLength2, fileLength: fileLength2} = getMSBLength(tmpBuffer.slice(metaLength))
      metaLength += metaLength2
      ofsOffset = fileLength2
      sourceLoadResult = await this.findObjectInPackfile(hash, packHash, packOffset - ofsOffset)
    }
    console.log({hash, packOffset, packDataType, metaLength, fileLength, refHash, ofsOffset}, tmpBuffer.slice(0, metaLength))

    // TODO: get source target
    // TODO: apply delta

    packStream.unshift(tmpBuffer.slice(metaLength))
    const contentStream = packStream
      .pipe(zlib.createInflate())

    return <LoadResult>{
      hash: hash,
      type: packDataType,
      length: fileLength,
      stream: contentStream,
    }
  }

  async findObjectInObject (hash: hash) {
    const objectPath = path.resolve(this.repoPath, 'objects', hash.substring(0, 2), hash.substring(2))
    try { await fs.access(objectPath) } catch (e) { return null }
    const fileStream = fs.createReadStream(objectPath)
    const contentStream = fileStream.pipe(zlib.createInflate())
    let chunk = await readUntil(contentStream, Buffer.alloc(1, NIL))

    const spaceIndex = chunk.indexOf(SPACE)
    const type = bufferGetAscii(chunk, 0, spaceIndex)

    const nilIndex = chunk.indexOf(NIL, spaceIndex)
    const length = bufferGetDecimal(chunk, spaceIndex + 1, nilIndex)

    return <LoadResult>{
      type: type,
      hash: hash,
      length: length,
      stream: contentStream,
    }
  }

  async loadObject (hash: hash, options: LoadOptions = {}) {
    let result: LoadResult
    if (!isHash(hash)) throw new Error(hash + ' is not hash')
    const objectPath = path.resolve(this.repoPath, 'objects', hash.substring(0, 2), hash.substring(2))
    
    result = await this.findObjectInObject(hash)
    if (!result) result = await this.findObjectInAllPack(hash)
    // if (!result) { throw new Error('no object') }

    if (options.loadAll) {
      result.buffer = Buffer.alloc(0)
      result.stream.on('data', (chunk: Buffer) => {
        result.buffer = Buffer.concat([result.buffer, chunk])
      })
      await new Promise(resolve => result.stream.on('end', resolve))
    }
    return result
  }
}

function getPackTypeByBit (bit: number) {
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
const HASH_REGEX = /^[0-9a-fA-F]{40}$/
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

async function listDeepFileList (root: string, prefix: string): Promise<Array<string>> {
  const files = await fs.readdir(path.resolve(root, prefix))
  files.filter(file => /^\./.test(file))
  const limiter = limitFactory(5)
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

function findAndPop (source: TreeNode, nodes: Array<TreeNode>): TreeNode {
  const index = nodes.findIndex(node => node.name === source.name)
  if (index >= 0) return nodes.splice(index, 1)[0]
}

function getMSBLength (buffer: Buffer, firstSkipBit: number = 1): {metaLength: number, fileLength: number} {
  let metaLength = 1
  let fileLength = buffer[0] & (Math.pow(2, (8 - firstSkipBit)) - 1)
  if (!(buffer[0] >> 7)) return {metaLength, fileLength}
  while (true) {
    const byte = buffer[metaLength++]
    const bitOffset = (8 - firstSkipBit) % 8 + 7 * (metaLength - 2)
    fileLength += (byte & 0x7f) << bitOffset
    if (!(byte >> 7)) break
  }
  return {metaLength, fileLength}
}