const express = require('express')
const redis = require('redis')
const path = require('path')
const url = require('url')

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
  db.auth(redisUrl.auth.split(":")[1])
} else {
  db = redis.createClient()
}

authorizeWebhook = (req, res) => {
  if (app.get('secret') !== req.params.secret) {
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
  if(mode) {
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
// NOT IS USE NOW
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
  const mode = process.env.LIGHT_MODE
  if (mode !== 'public' && mode !== 'ci') throw('Unknown light mode!')
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
    setColor(color, false)
  })

  console.log('HETRIX WEBHOOK RECEIVED', req.body)

  let errors
  if(req.body.monitor_errors) {
    //ping/status monitor
     errors = req.body.monitor_errors
  } else if(req.body.resource_usage){
    //resource warning
    setColor('red', true)
    return res.send(201)
  } else {
    setColor('green', true)
    return res.send(201)
  }

  //All errors to turn the light orange
  const orange_errors = [
    'timeout',
    'keyword not found',
    'http code 300',
    'http code 301',
    'http code 302',
    'http code 303',
    'http code 307',
    'http code 308',
  ]

  //All errors to turn the light red
  const red_errors = [
    'http code 400',
    'http code 401',
    'http code 402',
    'http code 403',
    'http code 404',
    'http code 405',
    'http code 406',
    'http code 408',
    'http code 409',
    'http code 414',
    'http code 429',
    'http code 431',
    'http code 495',
    'http code 496',
    'http code 497',
    'http code 500',
    'http code 501',
    'http code 502',
    'http code 503',
    'http code 504',
    'http code 505',
    'http code 511',
    'http code 522',
    'http code 525',
    'connection failed',
    'ssl failed',
    'auth failed'
  ]

  for(var key in errors) {
    let error = errors[key]

    if(red_errors.indexOf(error) >= 0) {
      //set the light on red
      setColor('red', true)
      return res.send(201)
    } else if(orange_errors.indexOf(error) >= 0) {
      //set the light orange
      setColor('orange', true)
      return res.send(201)
    }
  }
})

app.listen(app.get('port'))
