import * as path from 'path'
import {Repo, TreeNode} from '../src'
const repo = new Repo('./fixtures/repo')
console.log(repo)
async function main () {
  let hash
  const tree = await repo.loadTag('v0.1.0')
  console.log(tree)
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})
