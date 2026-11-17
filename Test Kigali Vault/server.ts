import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getUploadsDir, initDatabase } from './server/db.ts';
import { adminRouter } from './server/routes/adminRoutes.ts';
import { authRouter } from './server/routes/authRoutes.ts';
import { memberRouter } from './server/routes/memberRoutes.ts';
import { operationsRouter } from './server/routes/operationsRoutes.ts';
import { publicRouter } from './server/routes/public.ts';

async function startServer(): Promise<void> {
  initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '35mb' }));
  app.use(express.urlencoded({ extended: true, limit: '35mb' }));

  app.use('/uploads', express.static(getUploadsDir()));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'kigali-vault' });
  });

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/member', memberRouter);
  app.use('/api/operations', operationsRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run "npm run build" first.');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Kigali Vault server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Kigali Vault server:', err);
  process.exit(1);
});
