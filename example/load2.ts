import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  // let obj = await repo.loadObject('01c9e08fcbef8c6b68e746154e8da2485e19422a')
  // console.log(obj)
  const result = await repo.findObjectInPack('01c9e08fcbef8c6b68e746154e8da2485e19422a', '1f4c58f580744b553a4f0af91f9c0353ffc46a26')
  console.log(result)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
