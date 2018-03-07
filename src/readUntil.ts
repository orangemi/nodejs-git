import * as stream from 'stream'

export function readUntil (
  source: stream.Readable,
  delimiter: Buffer,
  options = {limit: 0}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const limit = options.limit || 0
    let len = 0
    let buffer = Buffer.alloc(0)
  
    source.on('end', onEnd)
    source.on('error', onError)

    onReadable()
    function onReadable () {
      let chunk: Buffer
      while ((chunk = source.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk])
        const index = buffer.indexOf(delimiter)
        if (index === -1) {
          if (limit > 0 && buffer.length + chunk.length > limit) {
            return done(new Error('Stream reach limit and not contain pattern'))
          }
          continue
        }
  
        source.unshift(buffer.slice(index + delimiter.length))
        buffer = buffer.slice(0, index)
        return done(null)
      }
      source.once('readable', onReadable)
    }
  
    function onError (err) {
      done(err)
    }
  
    function onEnd () {
      done(new Error('Stream did not contain pattern'))
    }
  
    function done (err: Error) {
      source.removeListener('end', onEnd)
      source.removeListener('error', onError)
      source.removeListener('readable', onReadable)
      if (err) return reject(err)
      return resolve(buffer)
    }

  })
}
