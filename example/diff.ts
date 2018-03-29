import * as path from 'path'
import {Repo, CommitResult} from '../src'
import * as diff from 'diff'
import * as colors from 'colors/safe'

const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadHead()
  commit = await repo.loadCommit('01c8f665e11cfb71f4e1460eb0efd3bc925bb8f5')
  while (true) {
    console.log('----------', commit.committer.date, '---------')
    console.log('commit:', commit.hash, commit.parent)
    console.log(commit.message)
    let parent = commit.parent[0] ? await repo.loadCommit(commit.parent[0]) : <CommitResult>{tree: ''}

    const diffs = await repo.diffTree(commit.tree, parent.tree)
    for (const diffOne of diffs) {
      console.log('diff: ', diffOne.leftMode, diffOne.rightMode, diffOne.path)
    }

    commit = parent
    if (!commit.hash) break
  }
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})