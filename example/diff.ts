import * as path from 'path'
import {Repo} from '../src'
import * as diff from 'diff'
import * as colors from 'colors/safe'

const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadHead()
  while (commit.parent.length) {
    console.log('----------')
    console.log('commit:', commit.hash)
    console.log(commit.message)
    let parent = await repo.loadCommit(commit.parent[0])
    const diffs = await repo.diffTree(commit.tree, parent.tree)

    for (const diffOne of diffs) {
      console.log('diff: ', diffOne.leftMode, diffOne.rightMode, diffOne.path)
      // let left = ''
      // let right = ''
      // if (diffOne.leftHash) {
      //   const blob = await repo.loadBlob(diffOne.leftHash, {loadAll: true})
      //   left = blob.buffer.toString('utf8')
      // }
      // if (diffOne.rightHash) {
      //   const blob = await repo.loadBlob(diffOne.rightHash, {loadAll: true})
      //   right = blob.buffer.toString('utf8')
      // }
      // const lines = diff.diffLines(right, left)
      // lines.forEach((part, i) => {
      //   var color = part.added ? 'green' : part.removed ? 'red' : 'grey'
      //   console.log('part', i)
      //   process.stdout.write(colors[color](part.value))
      // });
    }

    commit = parent
  }
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})