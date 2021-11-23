/* eslint-disable sort-imports */
import geckos, { Data, GeckosServer, RawMessage, iceServers, Middleware } from '@geckos.io/server'

// https://stackoverflow.com/a/55944697
import { dirname } from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// using with express
import express from 'express'
import http from 'http'
import { join } from 'path'

import bodyParser from 'body-parser'

const app = express()
const io: GeckosServer = geckos({
  iceServers: process.env.NODE_ENV === 'production' ? iceServers : [],
  authorization: async (auth, request) => {
    // console.log('auth', auth)
    // console.log('ip', request.connection.remoteAddress)
    // console.log('ip (behind proxy)', request.headers['x-forwarded-for'])
    return true
  }

  // cors: { origin: 'http://localhost:8080' }
  // cors: {
  //   origin: req => {
  //     // do some work and return a string
  //     return 'http://localhost:8080'
  //   }
  // }
})

app.use(bodyParser.json())
app.use('/.wrtc', Middleware(io.connectionsManager, io.cors))

app.use('/static/client', express.static(join(__dirname, '../dist/client')))

app.get('/', (req: any, res: any) => res.sendFile(join(__dirname, '../dist/client/index.html')))

// have to user server instead of app
app.listen(3000, () => {
  console.log('express is on http://localhost:3000')
})

io.onConnection(channel => {
  channel.onDisconnect(reason => {
    console.log('onDisconnect reason:', reason)
    io.emit('chat message', `Channel "${channel.id}" got disconnected!`)
  })

  channel.emit('chat message', `Welcome to the chat ${channel.id}!`)

  // send reliable messages to the client
  io.emit('some reliable event', 'very important message from server [io]', { reliable: true })
  channel.emit('some reliable event', 'very important message from server [channel]', { reliable: true })

  channel.on('chat message', (data: Data) => {
    // emit to all
    io.emit('chat message', `ALL: ${data}`)

    // emit the "chat message" data to all channels in the same room
    channel.room.emit('chat message', `ROOM: ${data}`)

    // emit the "chat message" data to all channels in the same room, except sender
    channel.broadcast.emit('chat message', data)

    // emits a message to the channel
    channel.emit('chat message', `SENT: ${data}`)
  })

  channel.onRaw((rawMessage: RawMessage) => {
    channel.raw.emit('RAW_MESSAGE')
  })
})
