import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  // const hash = '01c9e08fcbef8c6b68e746154e8da2485e19422a'
  const hash = '0d966a7cac8d6b8a6b4fadebb67141978839a24b'

  // const packs = await repo.listPack()
  const result = await repo.findObjectInAllPack(hash)
  console.log(result.type, result.length)
  console.log(result.stream)
  // console.log(result)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
