import { migrate } from './migrate.js'

if (process.env.VERCEL_ENV === 'production') {
  await migrate()
}
