#!/usr/bin/env node
/**
 * Cortivex HTTP Server
 *
 * Express server on port 3939 with REST API and WebSocket support
 * for real-time pipeline execution events.
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';

import pipelineRoutes from './routes/pipeline.js';
import meshRoutes from './routes/mesh.js';
import learningRoutes from './routes/learning.js';
import n8nExportRoutes from './routes/n8n-export.js';
import { createWebSocketHandler, getClientCount } from './ws/handler.js';
export { validateInput, validatePipelineName, validateAgentId } from './validation.js';

const PORT = parseInt(process.env.CORTIVEX_PORT ?? '3939', 10);

const app = express();

// ── Middleware ────────────────────────────────────────────────────────

// CORS: restrict to allowed origins (default: localhost only)
const ALLOWED_ORIGINS = (process.env.CORTIVEX_ALLOWED_ORIGINS ?? 'http://localhost:3939,http://localhost:3000,http://localhost:4200,http://127.0.0.1:3939,http://127.0.0.1:3000,http://127.0.0.1:4200')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, same-origin, server-to-server)
    // or from explicitly allowed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting to prevent DoS attacks
import rateLimit from 'express-rate-limit';
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.'
  }
});
app.use('/api/', limiter);

// Request logging
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────

// Pipeline endpoints
app.use('/api/pipeline', pipelineRoutes);

// List pipelines (convenience alias)
app.get('/api/pipelines', async (req, res) => {
  try {
    const { PipelineLoader } = await import('@cortivex/core');
    const loader = new PipelineLoader(process.cwd());

    // If ?full=true, return complete pipeline definitions with nodes
    if (req.query.full === 'true') {
      const list = await loader.listPipelines();
      const full = [];
      for (const p of list) {
        try {
          const def = await loader.load(p.name);
          full.push(def);
        } catch {
          // Skip pipelines that fail to load
        }
      }
      res.json(full);
    } else {
      const pipelines = await loader.listPipelines();
      res.json(pipelines);
    }
  } catch (err) {
    console.error('Failed to list pipelines:', err instanceof Error ? err.message : err);
    res.json([]);
  }
});

// GET /api/pipelines/:name — full pipeline definition
app.get('/api/pipelines/:name', async (req, res) => {
  try {
    const { PipelineLoader } = await import('@cortivex/core');
    const loader = new PipelineLoader(process.cwd());
    const pipeline = await loader.load(req.params.name);
    res.json(pipeline);
  } catch (err) {
    res.status(404).json({ error: `Pipeline "${req.params.name}" not found` });
  }
});

// Mesh endpoints
app.use('/api/mesh', meshRoutes);

// Learning endpoints
app.use('/api/learning', learningRoutes);

// N8n export (dedicated endpoint)
app.use('/api/export/n8n', n8nExportRoutes);

// ── Health / Info ────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    wsClients: getClientCount(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/info', (_req, res) => {
  res.json({
    name: 'Cortivex HTTP Server',
    version: '1.0.0',
    description: 'REST API and WebSocket server for Cortivex AI agent pipelines',
    endpoints: {
      'POST /api/pipeline/run': 'Run a pipeline',
      'POST /api/pipeline/create': 'Create pipeline from description',
      'GET /api/pipeline/status/:runId': 'Get run status',
      'GET /api/pipelines': 'List all pipelines',
      'POST /api/pipeline/export/n8n': 'Export to n8n format',
      'GET /api/mesh': 'Get mesh state',
      'GET /api/mesh/claims': 'Get mesh claims',
      'GET /api/mesh/conflicts': 'Get mesh conflicts',
      'GET /api/learning/insights': 'Get learning insights',
      'GET /api/learning/history': 'Get execution history',
      'GET /api/health': 'Health check',
      'WS /ws': 'Real-time event stream',
    },
  });
});

// ── 404 Handler ──────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'Use GET /api/info to see available endpoints.',
  });
});

// ── Error Handler ────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred. Please try again later.',
  });
});

// ── Start Server ─────────────────────────────────────────────────────

const httpServer = createServer(app);

// Attach WebSocket server
createWebSocketHandler(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Cortivex HTTP server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`API info: http://localhost:${PORT}/api/info`);
});

export { app, httpServer };
