import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let commit = await repo.loadCommit('HEAD')
  console.log('------------')
  console.log('HEAD COMMIT')
  console.log(commit.hash)

  const tree1 = await repo.loadTree(commit.tree)
  console.log('------------')
  console.log('COMMIT TREE')
  tree1.stream.on('data', (node: TreeNode) => console.log(node.hash, node.mode, node.name))
  await new Promise(resolve => tree1.stream.on('end', resolve))

  const tree2 = await repo.loadTree(commit.tree, {loadAll: true})
  console.log('Total', tree2.nodes.length)

  const fileInfo = tree2.nodes.filter(node => node.name === 'package.json')[0]
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
  console.log('master')
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