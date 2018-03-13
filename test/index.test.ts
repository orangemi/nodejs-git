import * as assert from 'assert'
import GitRepo from './GitHelper'
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
})