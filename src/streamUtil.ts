import * as stream from 'stream'

export interface streamReadOptions {
  limit?: number,
  skip?: number,
  ignoreEndError?: boolean,
}

export function readUntil (
  source: stream.Readable,
  delimiter: Buffer | string,
  options: streamReadOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const limit = options.limit || 0
    const skip = options.skip || 0
    const ignoreEndError = options.ignoreEndError || false
    let read = 0
    let buffer = Buffer.alloc(0)
  
    source.on('end', onEnd)
    source.on('error', onError)

    onReadable()
    function onReadable () {
      if (!source.readable) return done(null)
      let chunk: Buffer
      while ((chunk = source.read()) !== null) {
        if (read + chunk.length >= skip) {
          buffer = Buffer.concat([buffer, chunk.slice(Math.max(0, skip - read))])
        }
        read += chunk.length
        const index = buffer.indexOf(delimiter)
        if (index === -1) {
          if (limit > 0 && buffer.length > limit) {
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
      if (ignoreEndError) return done(null)
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

export function readLimit (
  source: stream.Readable,
  limit: number,
  options = {skip: 0}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const skip = options.skip || 0
    let read = 0
    let buffer = Buffer.alloc(0)
    
    source.on('end', onEnd)
    source.on('error', onError)

    onReadable()
    function onReadable () {
      if (!source.readable) return done(null)
      let chunk: Buffer
      while ((chunk = source.read()) !== null) {
        if (read + chunk.length >= skip) {
          buffer = Buffer.concat([buffer, chunk.slice(Math.max(0, skip - read))])
        }
        read += chunk.length
        if (buffer.length >= limit) {
          source.unshift(buffer.slice(limit))
          buffer = buffer.slice(0, limit)
          return done(null)
        }
      }
      source.once('readable', onReadable)
    }
  
    function onError (err) {
      done(err)
    }
  
    function onEnd () {
      done(null)
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

export function readSkip (
  source: stream.Readable,
  skip: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let read = 0

    source.on('end', onEnd)
    source.on('error', onError)

    onReadable()
    function onReadable () {
      if (!source.readable) return done(null)
      let chunk: Buffer
      while ((chunk = source.read()) !== null) {
        read += chunk.length
        if (read >= skip) {
          source.unshift(chunk.slice(chunk.length - read + skip))
          return done(null)
        }
      }
      source.once('readable', onReadable)
    }
  
    function onError (err) {
      done(err)
    }
  
    function onEnd () {
      done(null)
    }
  
    function done (err: Error) {
      source.removeListener('end', onEnd)
      source.removeListener('error', onError)
      source.removeListener('readable', onReadable)
      if (err) return reject(err)
      return resolve(read)
    }

  })
}

// export function createLimitedStream (limit: number) {
//   let read = 0
//   const tunnel = new stream.Transform({
//     transform(chunk: Buffer, encoding: string, callback: Function) {
//       if (read < limit) {
//         this.push(chunk.slice(0, limit - read))
//         if (read + chunk.length >= limit) this.push(null)
//         read += chunk.length
//         callback()
//       }
//     }
//   })
//   return tunnel
// }