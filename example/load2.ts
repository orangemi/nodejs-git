import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  // const hash = '01c9e08fcbef8c6b68e746154e8da2485e19422a'
  const hash = '85d5cd309e3e058b95a5e962f71f31b21bab1fe3'

  // const packs = await repo.listPack()
  const result = await repo.findObjectInAllPack(hash)
  console.log(result.type, result.length)
  result.stream.on('data', data => console.log(data.toString()))
  result.stream.on('end', () => console.log('data end'))
  // console.log(result.stream)
  // console.log(result)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
