import * as path from 'path'
import {Repo} from '../src'
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

  const fileInfo = tree.nodes.filter(node => node.name === 'package.json')[0]
  const blob = await repo.loadBlob(fileInfo.hash, {loadAll: true})
  console.log('------------')
  console.log('package.json')
  console.log(blob.buffer.toString())
  
  const branches = await repo.listBranches()
  console.log('------------')
  console.log('branches')
  console.log(branches)

  // const master = branches
  commit = await repo.loadBranch('master')
  console.log('------------')
  console.log(commit)

  const tags = await repo.listTags()
  console.log('------------')
  console.log('tags')
  console.log(tags)

}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})