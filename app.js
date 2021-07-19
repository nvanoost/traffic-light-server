const express = require('express')
const redis = require('redis')
const path = require('path')

const COLORS = ['red', 'yellow', 'green']

const app = express()
let db

app.set('secret', process.env.SECRET)
app.set('port', process.env.PORT || 3000)
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(express.logger('dev'))
app.use(express.json())
app.use(express.urlencoded())
app.use(express.static(path.join(__dirname, 'public')))

if (app.get('env') === 'production') {
  app.use(express.errorHandler())
  const redisUrl = new URL(process.env.REDISTOGO_URL)
  db = redis.createClient(redisUrl.port, redisUrl.hostname)
  db.auth(redisUrl.password)
} else {
  db = redis.createClient()
}

authorizeWebhook = (req, res) => {
  if (app.get('secret') !== req.params.secret) {
    console.error('USED INVALID SECRET:', req.params.secret)
    res.send(401)
    return false
  }

  return true
}

authorizeUser = (req, res) => {
  if (getLightMode() !== 'public') {
    res.send(401)
    return false
  }

  return true
}

setColor = (color, mode) => {
  db.set('trafficlight:' + color, mode)
  if(mode === 'true') {
    console.info('Light is set to', color)
  }
}

getColors = (callback) => {
  const mode = getLightMode()
  let data = { mode: getLightMode() }

  if (mode === 'public') {
    getPublicColors(callback, data)
  } else if (mode === 'ci') {
    getCiColors(callback, data)
  }
}

getPublicColors = (callback, data) => {
  let arr = COLORS.map(function (color) {
    return 'trafficlight:' + color;
  })

  db.mget(arr, (err, states) => {
    COLORS.forEach((color, index) => {
      data[color] = states[index] === 'true'
    })
    callback(null, data)
  })
}

// parse build status based on
// https://documentation.codeship.com/basic/getting-started/webhooks/
// NOT IN USE NOW
getCiColors = (callback, data) => {
  db.get('trafficlight:ci', function (err, buildStatus) {
    COLORS.forEach(function (color) { data[color] = false; })

    switch (buildStatus) {
    case 'error':
    case 'stopped':
    case 'ignored':
    case 'blocked':
    case 'infrastructure_failure':
      data.red = true
      break;
    case 'testing':
    case 'waiting':
      data.yellow = true
      break;
    case 'success':
      data.green = true
      break
    }

    callback(null, data)
  })
}

getLightMode = () => {
  let mode = process.env.LIGHT_MODE
  if (mode !== 'public' && mode !== 'ci') {
    if (app.get('env') === 'production') {
      throw('Unknown light mode!')
    } else {
      mode = 'public'
    }
  }
  return mode
}

app.get('/', (req, res) => {
  res.render('index')
})

app.get('/lights', (req, res) => {
  getColors((err, colors) => {
    res.send(colors)
  })
})

app.post('/lights', (req, res) => {
  if (!authorizeUser(req, res)) {
    return
  }

  COLORS.forEach((color) => {
    if (req.body.hasOwnProperty(color)) {
      setColor(color, req.body[color])
    }
  })

  getColors((err, colors) => {
    res.send(colors)
  })
})

app.post('/ci/:secret', (req, res) => {
  if (!authorizeWebhook(req, res)) {
    return
  }

  const status = req.body.build.status
  db.set('trafficlight:ci', status)

  res.send(201)
})

app.post('/hetrix-webhook/:secret', (req, res) => {
  if (!authorizeWebhook(req, res)) {
    return
  }

  //disable all lights
  COLORS.forEach( (color) => {
    setColor(color, 'false')
  })

  console.info('HETRIX WEBHOOK RECEIVED', req.body)

  let errors
  if(req.body.monitor_errors) {
    //ping/status monitor
     errors = req.body.monitor_errors
  } else if(req.body.resource_usage){
    //resource warning
    setColor('red', 'true')
    return res.send(201)
  } else {
    setColor('green', 'true')
    return res.send(201)
  }


  for(var key in errors) {
    let error = errors[key]

    switch (error) {
      case 'http code 401':
      case 'http code 402':
      case 'http code 400':
      case 'http code 403':
      case 'http code 404':
      case 'http code 405':
      case 'http code 406':
      case 'http code 408':
      case 'http code 409':
      case 'http code 414':
      case 'http code 429':
      case 'http code 431':
      case 'http code 495':
      case 'http code 496':
      case 'http code 497':
      case 'http code 500':
      case 'http code 501':
      case 'http code 502':
      case 'http code 503':
      case 'http code 504':
      case 'http code 505':
      case 'http code 511':
      case 'http code 522':
      case 'http code 525':
      case 'connection failed':
      case 'ssl failed':
      case 'auth failed':
        setColor('red', 'true')
        break;
      case 'timeout':
      case 'keyword not found':
      case 'http code 300':
      case 'http code 301':
      case 'http code 302':
      case 'http code 303':
      case 'http code 307':
      case 'http code 308':
        setColor('orange', 'true')
        break;
      default:
        console.warn('REICEVED UNRECOGNIZED ERROR:', errors[key])
        setColor('red', 'true')
    }
  }
  return res.send(201)
})

app.listen(app.get('port'))
console.info(`Server is listening at port ${app.get('port')}`)