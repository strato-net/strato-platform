import logger from './utils/logger';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createSafeRoutes } from './routes/safeRoutes';
import bodyParser from 'body-parser';
import { initializeSockets } from './sockets/initializeSockets';

// Load environment variables
dotenv.config();

const app = express();
const port = 3002; // Fixed port to 3002

app.use(cors());
app.use(bodyParser.json());

const safeRoutes = createSafeRoutes();

app.use('/api/safe', safeRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Initialize WebSocket connections
initializeSockets().catch(error => {
  logger.error('Failed to initialize WebSocket connections:', error);
});

// Start the server
app.listen(port, () => {
  logger.info(`Bridge service listening on port ${port}`);
}); 
