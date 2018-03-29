import * as path from 'path'
import * as cp from 'mz/child_process'
import * as fs from 'mz/fs'
import { randomBytes } from 'crypto';

export default class GitRepo {
  repo: string
  constructor(repo = '/tmp/demo-repo') {
    this.repo = repo
  }

  async help() {
    return exec(`git --help`, {cwd: this.repo})
  }

  async init() {
    await cp.exec(`mkdir -p ${this.repo}`, {cwd: '/tmp'})
    await exec(`git init`, {cwd: this.repo})
  }

  async addFile(file: string, content?: Buffer | string) {
    const filepath = path.resolve(this.repo, file)
    content = content || randomBytes(100)
    await fs.writeFile(filepath, content)
    return exec(`git add ${file}`, {cwd: this.repo})
  }

  async commit(message: string) {
    return exec(`git commit -m ${message}`, {cwd: this.repo})
  }

  async logs(options = {limit: 10}) {
    const limit = options.limit
    return exec(`git log -n ${limit}`, {cwd: this.repo})
  }

  async del() {
    await cp.exec(`rm -rf ${this.repo}`, {cwd: '/tmp'})
  }
}

async function exec(cmd: string, options?: cp.ExecOptions): Promise<string> {
  const result = await cp.exec(cmd, options)
  if (result['1']) throw new Error(result['1'].toString())
  return result['0'].toString()
}
