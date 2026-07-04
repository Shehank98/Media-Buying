import dotenv from 'dotenv';
dotenv.config();

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agencyRoutes from './routes/agency.routes.js';
import clientRoutes from './routes/client.routes.js';
import channelRoutes from './routes/channel.routes.js';
import propertyRoutes from './routes/property.routes.js';
import reportRoutes from './routes/report.routes.js';
import brandRoutes from './routes/brand.routes.js';
import scheduleLogRoutes from './routes/schedulelog.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import packageRoutes from './routes/package.routes.js';
import databaseRoutes from './routes/database.routes.js';
import masterdataRoutes from './routes/masterdata.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import searchRoutes from './routes/search.routes.js';
import forecastingRoutes from './routes/forecasting.routes.js';
import forecastInsightsRoutes from './routes/forecastInsights.routes.js';
import mediaBuyingRoutes from './routes/mediabuying.routes.js';
import profitRoutes from './routes/profit.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Behind Railway's proxy — trust the first hop so req.ip is the real client
// IP (used by the auth rate limiter), not the proxy's address.
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
    : '*',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// API routes under /api prefix
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agencies', agencyRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/schedule-logs', scheduleLogRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/masterdata', masterdataRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/forecasting', forecastingRoutes);
app.use('/api/forecasting', forecastInsightsRoutes);
app.use('/api/media-buying', mediaBuyingRoutes);
app.use('/api/profit', profitRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React frontend
const distPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 404 handler (for API routes when frontend isn't built)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
