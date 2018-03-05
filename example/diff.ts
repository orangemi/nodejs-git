import * as path from 'path'
import {Repo} from '../src'
import * as diff from 'diff'

const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadCommit('HEAD')
  console.log('------------')
  console.log('HEAD COMMIT')
  console.log(commit)

  const tree = await repo.loadTree(commit.tree, {loadAll: true})
  console.log('------------')
  console.log('COMMIT TREE')
  console.log(tree.nodes)

}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})