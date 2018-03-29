import * as assert from 'assert'
import GitRepo, { exec } from './GitHelper'
import {Repo} from '../src/'
describe('name', () => {
  let repopath = '/tmp/demo-repo'
  let gitRepo: GitRepo
  let repo: Repo

  beforeEach(async () => {
    gitRepo = new GitRepo(repopath)
    repo = new Repo(repopath + '/.git')
    await gitRepo.init()
  })

  afterEach(async () => {
    await gitRepo.del()
  })

  it('load one commit', async () => {
    await gitRepo.addFile('a.1')
    await gitRepo.commit('commit1')
    const commit = await repo.loadHead({loadAll: true})
    const logs = (await gitRepo.logs({limit: 1}))
    const commitHash = logs.match(/^commit ([a-f0-9]{40})/)[1]
    assert.strictEqual(commitHash, commit.hash)
  })

  it.only('load commit ok after gc', async () => {
    for (let i = 0; i < 10; i++) {
      await gitRepo.addFile('a.1')
      await gitRepo.commit('commit' + i)
    }

    await exec('git gc', {cwd: gitRepo.repo})
    console.log(await exec('ls -la .git', {cwd: gitRepo.repo}))
    console.log(await exec('ls -la .git/refs', {cwd: gitRepo.repo}))
    console.log(await exec('ls -la .git/refs/heads', {cwd: gitRepo.repo}))
    console.log(await exec('cat .git/HEAD', {cwd: gitRepo.repo}))
    process.exit(0)
    // let t = await exec('cat .git/objects/info/packs', {cwd: gitRepo.repo})

    // let packHash = t.trim().substring(2).replace(/pack$/, 'idx')
    // console.log({packHash})
    // t = await exec(`git verify-pack -v .git/objects/pack/${packHash}`, {cwd: gitRepo.repo})
    // console.log(t)

    const headCommit = await repo.loadHead({loadAll: true})
    console.log(headCommit)
    // const logs = await gitRepo.logs(1)
    // const commitHash = logs.match(/^commit ([a-f0-9]{40})/)[1]
    // assert.strictEqual(commitHash, commit.hash)
  })

})