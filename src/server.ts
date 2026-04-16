// ─── Senviok — Fastify Server Bootstrap ──────────────────────────────────────

import 'dotenv/config'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'

import { env } from './config/env'
import prismaPlugin from './plugins/prisma'
import redisPlugin from './plugins/redis'
import authPlugin from './plugins/auth'

import { authRoutes } from './routes/auth'
import { domainRoutes } from './routes/domains'
import { emailRoutes } from './routes/emails'
import { templateRoutes } from './routes/templates'
import { webhookRoutes } from './routes/webhooks'
import { analyticsRoutes } from './routes/analytics'

import { AppError } from './lib/errors'
import { hashApiKey } from './lib/crypto'
import type { ApiError } from './types'

async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  })

  // ── Security ────────────────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // relax for Swagger UI
  })

  await app.register(fastifyCors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  })

  // ── Rate Limiting ───────────────────────────────────────────────────────────
  await app.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => {
      // Rate limit by hashed API key or IP
      const auth = request.headers.authorization
      if (auth?.startsWith('Bearer snv_')) {
        return hashApiKey(auth.slice(7))
      }
      return request.ip
    },
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
    }),
  })

  // ── JWT ─────────────────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256' },
  })

  // ── OpenAPI / Swagger ───────────────────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Senviok API',
        description:
          'Developer-friendly email infrastructure for African startups. Powered by AWS SES (af-south-1).',
        version: '1.0.0',
        contact: { name: 'Senviok', url: 'https://senviok.com' },
      },
      servers: [{ url: env.APP_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT or API Key' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication & API keys' },
        { name: 'Domains', description: 'Domain verification & DNS setup' },
        { name: 'Emails', description: 'Send & track emails' },
        { name: 'Templates', description: 'Reusable email templates' },
        { name: 'Analytics', description: 'Send statistics' },
        { name: 'Webhooks', description: 'SES event webhooks' },
      ],
    },
  })

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  })

  // ── Plugins ─────────────────────────────────────────────────────────────────
  await app.register(prismaPlugin)
  await app.register(redisPlugin)
  await app.register(authPlugin)

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/v1' })
  await app.register(domainRoutes, { prefix: '/v1' })
  await app.register(emailRoutes, { prefix: '/v1' })
  await app.register(templateRoutes, { prefix: '/v1' })
  await app.register(webhookRoutes, { prefix: '/v1' })
  await app.register(analyticsRoutes, { prefix: '/v1' })

  // ── Health Check ─────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'senviok',
    region: env.AWS_REGION,
    timestamp: new Date().toISOString(),
  }))

  // ── Global Error Handler ─────────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    // Known application errors
    if (error instanceof AppError) {
      const body: ApiError = {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      }
      return reply.status(error.statusCode).send(body)
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.status(422).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: error.validation },
      })
    }

    // JWT errors
    if (error.statusCode === 401) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: error.message },
      })
    }

    // Unexpected errors — log and return generic message
    app.log.error(error)
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    })
  })

  return app
}

// ── Start ──────────────────────────────────────────────────────────────────────

async function start() {
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(`🚀 Senviok API running at http://${env.HOST}:${env.PORT}`)
    app.log.info(`📖 API docs at http://${env.HOST}:${env.PORT}/docs`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()

export { buildApp }
