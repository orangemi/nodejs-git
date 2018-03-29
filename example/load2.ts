import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let hash
  hash = '01c9e08fcbef8c6b68e746154e8da2485e19422a'
  hash = '8e5c1d4ad4176644f0d4aefda24399d5e64f2b51'
  hash = '041bff8f7b1a6d77d3149b5797146d5e88df8350'
  hash = 'bc92aff41b3e86ef2663317a9a73c5809a1ab7e0'
  hash = 'f8bb9f5d1f55eb312eef8f8226256f9533c07c86'
  // hash = '041bff8f7b1a6d77d3149b5797146d5e88df8350'
  // hash = 'e46c042c69177b60c433ef6ab6c5fa7f1eb62994'


  // const packs = await repo.listPack()
  // const result = await repo.findObjectInAllPack(hash)
  // console.log(result.hash, result.type, result.length)
  // result.stream.pipe(process.stdout)
  // result.stream.on('data', data => console.log(data.toString()))
  // result.stream.on('end', () => console.log('data end'))
  // console.log(result.stream)
  // console.log(result)
  // const tree = await repo.loadObject(hash, {loadAll: true})
  // console.log(tree.buffer)
  const tree = await repo.loadTree(hash, {loadAll: true})
  console.log(tree.nodes)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
