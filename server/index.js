import 'dotenv/config'
import express from 'express'
import { resolve } from 'node:path'
import app from './app.js'

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')))
}
app.listen(Number(process.env.PORT || 3001), '127.0.0.1', () => console.log('EtherLens proxy ready on http://127.0.0.1:' + (process.env.PORT || 3001)))
