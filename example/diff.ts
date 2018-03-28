import * as path from 'path'
import {Repo} from '../src'
import * as diff from 'diff'
import * as colors from 'colors/safe'

const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadHead()
  commit = await repo.loadCommit('01c8f665e11cfb71f4e1460eb0efd3bc925bb8f5')
  console.log(commit.parent, commit.parent.length)
  while (commit.parent.length) {
    console.log('----------', commit.committer.date, '---------')
    console.log('commit:', commit.hash, commit.parent)
    console.log(commit.message)
    let parent = await repo.loadCommit(commit.parent[0])

    // const diffs = await repo.diffTree(commit.tree, parent.tree)
    // for (const diffOne of diffs) {
    //   console.log('diff: ', diffOne.leftMode, diffOne.rightMode, diffOne.path)
    // }

    commit = parent
    // console.log('++++', commit.parent, commit.parent.length)
  }
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})