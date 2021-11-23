import http, { IncomingMessage, ServerResponse } from 'http'
import ConnectionsManagerServer from '../wrtc/connectionsManager.js'
import { CorsOptions } from '@geckos.io/common/lib/types.js'
import ParseBody from './parseBody.js'
import SetCORS from './setCors.js'
import url from 'url'

interface Request extends IncomingMessage {
  body: any
  url: string
}

interface Response extends ServerResponse {
  sendStatus(statusCode: number): void
  json(json: object): void
}

const end = (res: http.ServerResponse, statusCode: number) => {
  res.writeHead(statusCode)
  res.end()
}

export const Middleware =
  (connectionsManager: ConnectionsManagerServer, cors: CorsOptions) =>
  async (req: Request, res: Response, next: Function) => {
    const prefix = 'v2'
    const root = `/${prefix}`
    const rootRegEx = new RegExp(`/${prefix}`)

    const pathname = req.url ? new URL(req.url, `http://${req.headers.host}`).pathname : undefined
    const headers = req.headers
    const method = req.method
    const body = req.body

    const forGeckos = method && pathname && rootRegEx.test(pathname)

    if (!forGeckos) return next()

    const _connections = method === 'POST' && pathname === `${root}/connections`
    const _remote_description =
      method === 'POST' && new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/remote-description`).test(pathname)
    const _additional_candidates =
      method === 'GET' && new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/additional-candidates`).test(pathname)
    const _close = method === 'POST' && new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/close`).test(pathname)

    SetCORS(req, res, cors)

    res.setHeader('Content-Type', 'application/json')

    if (_connections) {
      try {
        // create connection (and check auth header)
        const { status, connection, userData } = await connectionsManager.createConnection(
          headers?.authorization,
          req,
          res
        )

        // on http status code
        if (status !== 200) {
          if (status >= 100 && status < 600) return res.sendStatus(status)
          else return res.sendStatus(500)
        }

        if (!connection || !connection.id) return res.sendStatus(500)

        const { id, localDescription } = connection

        if (!id || !localDescription) return res.sendStatus(500)

        return res.json({
          userData, // the userData for authentication
          id,
          localDescription
        })
      } catch (error) {
        return res.sendStatus(500)
      }
    }

    if (_remote_description) {
      const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
      if (ids && ids.length === 1) {
        const id = ids[0]
        const connection = connectionsManager.getConnection(id)

        if (!connection) return res.sendStatus(404)

        try {
          const { sdp, type } = body
          connection.peerConnection.setRemoteDescription(sdp, type)

          return res.sendStatus(200)
        } catch (err: any) {
          return res.sendStatus(400)
        }
      } else {
        return res.sendStatus(400)
      }
    }

    if (_additional_candidates) {
      const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
      if (ids && ids.length === 1) {
        const id = ids[0]
        const connection = connectionsManager.getConnection(id)

        if (!connection) {
          return res.sendStatus(404)
        }

        try {
          const additionalCandidates = [...connection.additionalCandidates]
          connection.additionalCandidates = []
          return res.json(additionalCandidates)
        } catch (error) {
          return res.sendStatus(400)
        }
      } else {
        return res.sendStatus(400)
      }
    }

    if (_close) {
      const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
      if (ids && ids.length === 1) {
        const id = ids[0]
        const connection = connectionsManager.getConnection(id)
        connection?.close()
        return res.sendStatus(200)
      } else {
        return res.sendStatus(400)
      }
    }

    return res.sendStatus(404)
  }

const HttpServer = (server: http.Server, connectionsManager: ConnectionsManagerServer, cors: CorsOptions) => {
  const prefix = '.wrtc'
  const version = 'v2'
  const root = `/${prefix}`
  const rootRegEx = new RegExp(`/${prefix}`)

  const evs = server.listeners('request').slice(0)
  server.removeAllListeners('request')

  server.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const pathname = req.url ? url.parse(req.url, true).pathname : undefined
    const headers = req.headers
    const method = req.method

    const forGeckos = pathname && rootRegEx.test(pathname)

    // if the request is not part of the rootRegEx,
    // trigger the other server's (Express) events.
    if (!forGeckos) {
      for (var i = 0; i < evs.length; i++) {
        evs[i].call(server, req, res)
      }
    }

    if (forGeckos) {
      const path1 = pathname === `${root}/connections`
      const path2 = new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/remote-description`).test(pathname)
      const path3 = new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/additional-candidates`).test(pathname)
      const closePath = new RegExp(`${prefix}/connections/[0-9a-zA-Z]+/close`).test(pathname)

      SetCORS(req, res, cors)

      if (req.method === 'OPTIONS') return end(res, 200)

      let body = ''

      try {
        body = (await ParseBody(req)) as string
      } catch (error) {
        return end(res, 400)
      }

      res.on('error', _error => {
        return end(res, 500)
      })

      res.setHeader('Content-Type', 'application/json')

      if (pathname && method) {
        if (method === 'POST' && path1) {
          try {
            // create connection (and check auth header)
            const { status, connection, userData } = await connectionsManager.createConnection(
              headers?.authorization,
              req,
              res
            )

            // on http status code
            if (status !== 200) {
              if (status >= 100 && status < 600) return end(res, status)
              else return end(res, 500)
            }

            if (!connection || !connection.id) return end(res, 500)

            const { id, localDescription } = connection

            if (!id || !localDescription) return end(res, 500)

            res.write(
              JSON.stringify({
                userData, // the userData for authentication
                id,
                localDescription
              })
            )
            return res.end()
          } catch (error) {
            return end(res, 500)
          }
        } else if (method === 'POST' && path2) {
          const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
          if (ids && ids.length === 1) {
            const id = ids[0]
            const connection = connectionsManager.getConnection(id)

            if (!connection) return end(res, 404)

            try {
              const { sdp, type } = JSON.parse(body)
              connection.peerConnection.setRemoteDescription(sdp, type)

              return end(res, 200)
            } catch (error) {
              return end(res, 400)
            }
          } else {
            return end(res, 400)
          }
        } else if (method === 'GET' && path3) {
          const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
          if (ids && ids.length === 1) {
            const id = ids[0]
            const connection = connectionsManager.getConnection(id)

            if (!connection) {
              return end(res, 404)
            }

            try {
              const additionalCandidates = [...connection.additionalCandidates]
              connection.additionalCandidates = []
              res.write(JSON.stringify(additionalCandidates))
              return res.end()
            } catch (error) {
              return end(res, 400)
            }
          } else {
            return end(res, 400)
          }
        } else if (method === 'POST' && closePath) {
          const ids = pathname.match(/[0-9a-zA-Z]{24}/g)
          if (ids && ids.length === 1) {
            const id = ids[0]
            const connection = connectionsManager.getConnection(id)
            connection?.close()
            return end(res, 200)
          } else {
            return end(res, 400)
          }
        } else {
          return end(res, 404)
        }
      }
    }
  })
}

export default HttpServer
