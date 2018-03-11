import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  // const hash = '01c9e08fcbef8c6b68e746154e8da2485e19422a'
  // const hash = '8e5c1d4ad4176644f0d4aefda24399d5e64f2b51'
  const hash = 'fe59f472319660c9fd0f45d325e8f5fe465cffe1'

  // const packs = await repo.listPack()
  const result = await repo.findObjectInAllPack(hash)
  console.log(result.type, result.length)
  result.stream.pipe(process.stdout)
  // result.stream.on('data', data => console.log(data.toString()))
  // result.stream.on('end', () => console.log('data end'))
  // console.log(result.stream)
  // console.log(result)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
