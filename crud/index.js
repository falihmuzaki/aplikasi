import express from 'express'
import api from './server/index.js'

const app = express()

app.use(api)

export default app
