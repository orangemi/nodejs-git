import * as path from 'path'
import {Repo} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  const commit = await repo.loadCommit('HEAD')
  console.log('------------')
  console.log('HEAD COMMIT')
  console.log('------------')
  console.log(commit)

  const tree = await repo.loadTree(commit.tree, {loadAll: true})
  console.log('------------')
  console.log('COMMIT TREE')
  console.log('------------')
  console.log(tree.nodes)

  const fileInfo = tree.nodes.filter(node => node.name === 'package.json')[0]
  const blob = await repo.loadBlob(fileInfo.hash, {loadAll: true})
  console.log('------------')
  console.log('package.json')
  console.log('------------')
  console.log(blob.buffer.toString())
  
  const branches = await repo.loadBranches()
  console.log('------------')
  console.log('branches')
  console.log('------------')
  console.log(branches)

  const tags = await repo.loadTags()
  console.log('------------')
  console.log('tags')
  console.log('------------')
  console.log(tags)

}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})