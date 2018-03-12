import { Readable } from 'stream'

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
