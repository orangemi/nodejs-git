import * as path from 'path'
import {Repo} from '../src'
import * as diff from 'diff'

const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadCommit('HEAD')
  while (commit.parent.length) {
    console.log('----------')
    console.log('commit:', commit.hash)
    console.log(commit.message)
    console.log('----------')
    let parent = await repo.loadCommit(commit.parent[0])
    const diff = await repo.diffTree(commit.tree, parent.tree)
    console.log(diff)
    commit = parent
  }
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})