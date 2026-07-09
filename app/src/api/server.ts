import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from './middleware/error';
import { requestLoggingMiddleware, errorLoggingMiddleware } from './middleware/logging';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import logsRoutes from './routes/logs';
import { logger } from '../utils/logger';
import { EnvironmentManager } from '../config/env';
import { createAuthMiddleware, getApiKey } from '../auth/middleware';
import { swaggerSpec } from './swagger';

const app = express();

// Middleware
app.use(cors());
// express.json() defaults to a 100kb limit, which a full IDE conversation
// (history + open-file context + tool schemas) blows past easily, rejecting
// the request outright with no useful error surfaced to the caller.
app.use(express.json({ limit: '50mb' }));

// Enhanced request/response logging middleware (debug mode)
if (EnvironmentManager.isDebugMode()) {
  app.use(requestLoggingMiddleware);
} else {
  // Basic request logging for standard mode
  app.use((req, _res, next) => {
    logger.info('Request received', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent')
    });
    next();
  });
}

// Optional HTTP API protection middleware (lazy initialization to handle runtime API key setting)
app.use((req, res, next) => {
  const apiKey = getApiKey();
  const authMiddleware = createAuthMiddleware({
    // Public endpoints (no API key required). /logs is intentionally NOT here:
    // it can expose request bodies/headers, so it must sit behind auth.
    skipPaths: ['/health', '/docs', '/swagger.json', '/v1/auth/status'],
    ...(apiKey && { apiKey }) // Only include apiKey if it exists
  });
  authMiddleware(req, res, next);
});

// Swagger documentation routes (always public)
app.get('/swagger.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Claude Wrapper API Documentation'
}));

// Routes
app.use('/', healthRoutes);
app.use('/', modelsRoutes);
app.use('/', authRoutes);
app.use('/', logsRoutes);
app.use('/', chatRoutes);

// Error handling (must be last)
if (EnvironmentManager.isDebugMode()) {
  app.use(errorLoggingMiddleware);
}
app.use(errorHandler);

export function createServer() {
  return app;
}

export function startServer(): void {
  const config = EnvironmentManager.getConfig();
  
  app.listen(config.port, config.host, () => {
    logger.info('Server started successfully', {
      port: config.port,
      host: config.host,
      environment: EnvironmentManager.isProduction() ? 'production' : 'development'
    });
  });
}

export default app;