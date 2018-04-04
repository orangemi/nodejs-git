import {Repo} from '../src'
import * as colors from 'colors/safe'

const repo = new Repo('./fixtures/repo2')
async function main () {
  await repo.init()
}

main().catch(err => {
  console.error(err)
  console.error(err.stack)
})