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
    let version = 2
    // let offset2 = 0
    let headBuffer = await readLimit(idxStream, 256 * 4)
    if (headBuffer.readUIntBE(0, 4) === PACK_IDX_2_FANOUT0, headBuffer.readUIntBE(4, 4) === 2) {
      offset += 8
      headBuffer = Buffer.concat([headBuffer.slice(8), await readLimit(idxStream, 8)])
    }
    const totalObjects = headBuffer.readUIntBE(255 * 4, 4)
    const fanoutStart = hashFanIdx > 0 ? headBuffer.readUIntBE((hashFanIdx - 1) * 4, 4) : 0
    const fanoutEnd = headBuffer.readUIntBE(hashFanIdx * 4, 4)

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
    // await readSkip(packStream, skip)
    const b = await readLimit(packStream, 1, {skip: skip})
    const firstByte = b[0]
    const packDataType = getPackTypeByBit((firstByte & 0x70) >> 4)

    // let {metaLength, fileLength} = parseVInt(tmpBuffer, 4)
    let fileLength = await parseVInt(packStream, firstByte, 4)

    // console.log({packDataType, fileLength})
    // let refHash = ''
    // let ofsOffset = 0
    let getSourceResult: () => Promise<LoadResult>
    // let sourceLoadResult: LoadResult
    if (packDataType === 'ref_delta') {
      const refHashBuffer = await readLimit(packStream, 20)
      const refHash = refHashBuffer.toString('hex')
      // refHash = tmpBuffer.slice(metaLength, metaLength + 20).toString('hex')
      // metaLength += 20
      getSourceResult = () => this.loadObject(refHash)
      // sourceLoadResult = await this.loadObject(refHash)
    } else if (packDataType === 'ofs_delta') {
      const ofsOffset = await parseVInt2(packStream)
      // metaLength += metaLength2
      // ofsOffset = fileLength2
      //console.log({metaLength2, ofsOffset})
      getSourceResult = () => this.findObjectInPackfile(hash, packHash, packOffset - ofsOffset)
      // sourceLoadResult = await this.findObjectInPackfile(hash, packHash, packOffset - ofsOffset)
    }
    // console.log({hash, packOffset, packDataType, metaLength, fileLength, refHash, ofsOffset}, tmpBuffer.slice(0, metaLength))

    // packStream.unshift(tmpBuffer.slice(metaLength))
    const contentStream = packStream
      .pipe(zlib.createInflate())

    let targetStream: Readable = contentStream
    if (packDataType === 'ref_delta' || packDataType === 'ofs_delta') {
      // TODO: apply delta
      targetStream = mergeDeltaStream(contentStream, getSourceResult)
    }

    return <LoadResult>{
      hash: hash,
      type: packDataType,
      length: fileLength,
      stream: targetStream,
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

async function parseVInt (stream: Readable, firstByte: number, firstSkipBit: number = 1): Promise<number> {
  // console.log('parseVInt', firstByte.toString(2))
  let metaLength = 0
  let fileLength = firstByte & (Math.pow(2, (8 - firstSkipBit)) - 1)
  // console.log('parseVInt1', fileLength)
  if (!(firstByte >> 7)) fileLength
  while (true) {
    const byteBuffer = await readLimit(stream, 1)
    const byte = byteBuffer[0]
    const bitOffset = (8 - firstSkipBit) % 8 + 7 * (metaLength++)
    fileLength += (byte & 0x7f) << bitOffset
    // console.log('parseVInt2', fileLength, byte.toString(2), bitOffset)
    if (!(byte >> 7)) break
  }
  return fileLength
}

async function parseVInt2 (stream: Readable): Promise<number> {
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

function mergeDeltaStream (delta: Readable, getSourceResult: () => Promise<LoadResult>) {
  let isHeadRead = false
  let isReading = false
  let canPush = true
  let sourceRead = 0
  let sourceStream: Readable

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

  async function readHead () {
    let rev
    let metaLength = 0
    const firstByteBuffer1 = await readLimit(delta, 1)
    const sourceLength = await parseVInt(delta, firstByteBuffer1[0])
    const firstByteBuffer2 = await readLimit(delta, 1)
    const targetLength = await parseVInt(delta, firstByteBuffer2[0])

    // console.log({sourceLength, targetLength})
    isHeadRead = true
  }

  const target = new Readable({
    async read() {
      if (isReading) return
      isReading = true
      // console.log('reading')
      if (!isHeadRead) await readHead()

      while (true) {
        const buffer = await readLimit(delta, 1)
        // console.log(buffer)
        const MSB = buffer[0] >> 7
        if (MSB) {
          let byteOffset = 1
          let offset = 0
          let length = 0
          // copy
          for (let bit = 0; bit < 4; bit++) {
            if (buffer[0] & (1 << bit)) {
              const b = await readLimit(delta, 1)
              offset = offset | (b[0] << (8 * bit))
            }
          }

          for (let bit = 4; bit < 7; bit++) {
            if (buffer[0] & (1 << bit)) {
              const b = await readLimit(delta, 1)
              length = length | (b[0] << (8 * bit))
            }
          }

          // console.log('🈴🈴', offset, length, byteOffset, buffer)
          let source = await getSourceStream()
          if (offset < sourceRead) {
            // console.log('offset is before read from source', {sourceRead, offset, length})
            source = await getSourceStream(true)
            sourceRead = 0
          }
          const data = await readLimit(source, length, {skip: offset - sourceRead})
          // console.log('copying', offset, length, byteOffset, {sourceRead, skip: offset - sourceRead})
          canPush = target.push(data)
          // delta.unshift(buffer.slice(byteOffset))
          sourceRead = offset + length
        } else {
          // insert
          let length = buffer[0]
          // console.log('inserting', length)
          const data = await readLimit(delta, length)
          canPush = target.push(data)
          // canPush = target.push(buffer.slice(1, length + 1))
          // delta.unshift(buffer.slice(length + 1))
        }
        if (!canPush) break
        // console.log(rev, buffer)
      }
      isReading = false
      console.log('reading end')
    }
  })

  return target
}
