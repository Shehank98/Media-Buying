import dotenv from 'dotenv';
dotenv.config();

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

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
    : '*',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/agencies', agencyRoutes);
app.use('/clients', clientRoutes);
app.use('/channels', channelRoutes);
app.use('/properties', propertyRoutes);
app.use('/reports', reportRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
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
