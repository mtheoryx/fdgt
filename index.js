// Module imports
const faker = require('faker')
const mri = require('mri')
const { v4: uuid } = require('uuid')
const WebSocket = require('ws')





// Local imports
const Channel = require('./structures/Channel')
const getMock = require('./helpers/getMock')
const log = require('./helpers/log')
const serializeTwitchObject = require('./helpers/serializeTwitchObject')
const User = require('./structures/User')
const UserList = require('./structures/UserList')





// Local constants
const {
  PORT = 3001,
} = process.env
const channels = {}
const users = new UserList
const HOST = 'tmi.twitch.tv'
const server = new WebSocket.Server({ port: PORT })





const parseMessage = (message, socketDataStore) => {
  const {
    username,
  } = socketDataStore
  let command = message.split(':')[0].trim()

  if (command === 'CAP REQ') {
    return {
      command,
      data: message.replace(/^CAP REQ :/u, '').split(' '),
      set: true,
      type: 'capabilities',
    }
  }

  if (message.startsWith('JOIN')) {
    const channelName = message.replace(/^JOIN /u, '').trim().replace(/^#/u, '')
    let channel = channels[channelName]
    let user = users.findByUsername(username)

    if (!channel) {
      channel = new Channel({
        isConnected: true,
        name: channelName,
      })
      channels[channelName] = channel
    }

    if (!channel.isConnected) {
      channel.connect()
    }

    if (!user) {
      user = new User({ username })
      users.addUser(user)
    }

    channel.addUser(user)

    return {
      command,
      response: [
        `:${username}!${username}@${username}.${HOST} JOIN #${channel.name}`,
        `:${username}.${HOST} 353 ${username} = #${channel.name} :${username}`,
        `:${username}.${HOST} 366 ${username} #${channel.name} :End of /NAMES list`,
        `@emote-only=0;followers-only=-1;r9k=0;rituals=0;room-id=${channel.id};slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #${channel.name}`,
      ].join('\r\n'),
      type: 'channels',
    }
  }

  if (message.startsWith('NICK')) {
    return {
      command,
      data: message.replace(/^NICK /u, ''),
      set: true,
      type: 'username',
    }
  }

  if (message.startsWith('PASS')) {
    return {
      command,
      data: message.replace(/^PASS /u, ''),
      set: true,
      type: 'token',
    }
  }

  if (message.startsWith('PING')) {
    return {
      command: 'PING',
      response: 'PONG',
      type: 'ping',
    }
  }

  if (message.startsWith('PONG')) {
    clearTimeout(socketDataStore.pongTimeoutID)

    return {
      command: 'PONG',
      type: 'pong',
    }
  }

  if (message.startsWith('PRIVMSG')) {
    const [, channelName, eventTrigger, messageBody] = /^PRIVMSG #(\w+) :([\S]*)(.*)$/u.exec(message)
    let channel = channels[channelName]
    let user = null

    if (!channel) {
      channel = new Channel({ name: channelName })
      channels[channelName] = channel
    }

    if (channel.isEmpty || (Math.random() >= 0.75)) {
      user = new User({ username: faker.internet.userName().replace(/\./gu, '') })
      users.addUser(user)
      channel.addUser(user)
    } else {
      user = channel.getRandomUser()
    }

    const parameters = {
      bitscount: 100,
      channel: channelName,
      channelid: channel.id,
      color: user.color,
      giftcount: 5,
      host: HOST,
      message: messageBody,
      messageid: uuid(),
      months: 3,
      timestamp: Date.now(),
      userid: user.id,
      username: user.username,
      viewercount: 10,
      ...mri(messageBody.split(' ')),
    }

    const timeAsMoment = moment(parameters.timestamp)

    parameters.endmonth = timeAsMoment.month() + parameters.months
    parameters.endmonthname = timeAsMoment.format('MMMM')

    if (!parameters.totalgiftcount) {
      parameters.totalgiftcount = parameters.giftcount
    }

    return {
      command: 'PRIVMSG',
      response: `${serializeTwitchObject(messageData.tags)} ${messageData.message}`,
      type: 'message',
    }
  }

  return {
    command,
    message,
    response: `:${HOST} 421 ${username} ${command} :Unknown command`,
    type: 'unknown',
  }
}

server.on('connection', socket => {
  const socketDataStore = {
    capabilities: null,
    id: uuid(),
    isAcknowledged: false,
    pongTimeoutID: null,
    token: null,
    username: null,
  }

  log('New client connected', { id: socketDataStore.id }, 'info')

  socket.on('message', message => {
    const { id } = socketDataStore
    const {
      command,
      data,
      response = false,
      set = false,
      type,
    } = parseMessage(message, socketDataStore)

    log('Message from client', {
      id,
      message,
    }, 'info')

    if (response) {
      socket.send(response)
    }

    if (set) {
      socketDataStore[type] = data
    }

    if (!socketDataStore.isAcknowledged) {
      const {
        capabilities,
        token,
        username,
      } = socketDataStore

      if (capabilities && token && username) {
        log('Acknowledging client', { id })
        socket.send(`:${HOST} CAP * ACK :${capabilities.join(' ')}`)
        socket.send([
          `:${HOST} 001 ${username} :Welcome, GLHF!`,
          `:${HOST} 002 ${username} :Your host is ${HOST}`,
          `:${HOST} 003 ${username} :This server is rather new`,
          `:${HOST} 004 ${username} :-`,
          `:${HOST} 375 ${username} :-`,
          `:${HOST} 372 ${username} :You are in a maze of twisty passages, all alike.`,
          `:${HOST} 376 ${username} :>`,
        ].join('\r\n'))
        socket.send('PING')
        socketDataStore.isAcknowledged = true
      }
    }
  })

  setInterval(() => {
    const { id } = socketDataStore
    socketDataStore.pongTimeoutID = setTimeout(() => {
      log('Client didn\'t PONG in time - terminating connection', { id }, 'error')
      socket.terminate()
    }, 1000)

    log('Pinging client', { id }, 'info')
    socket.send('PING')
  }, 30000)
  // Ping the client every 30 seconds. Otherwise, Heroku will kill the
  // connection.
})

log(`Server started. Listening on port ${PORT}...`)
