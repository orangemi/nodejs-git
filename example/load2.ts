import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  // let obj = await repo.loadObject('01c9e08fcbef8c6b68e746154e8da2485e19422a')
  // console.log(obj)
  // commit 9acdec3f2f8fa25322f606f6d1fec7ba54280d89
  // blob 44bd540a57903d32b0912a363463806863ce3e47
  // const result = await repo.findObjectInPack('9acdec3f2f8fa25322f606f6d1fec7ba54280d89', '1f4c58f580744b553a4f0af91f9c0353ffc46a26')
  const hash = '01c9e08fcbef8c6b68e746154e8da2485e19422a'

  // const packs = await repo.listPack()
  const result = await repo.loadObject(hash, {loadAll: true})
  console.log(result.type, result.length)
  console.log(result.buffer.toString())
  // console.log(result)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
