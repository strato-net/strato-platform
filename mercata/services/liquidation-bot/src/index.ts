import express, { Request, Response } from 'express';
import { config } from './config';
import { logger } from './utils/logger';
import { CDPLiquidationService } from './services/cdpLiquidationService';
import { VaultService } from './services/vaultService';
import { LiquidationPolling } from './polling/liquidationPolling';

// Initialize services
const app = express();
app.use(express.json());

const cdpService = new CDPLiquidationService();
const vaultService = new VaultService();
const polling = new LiquidationPolling(cdpService, vaultService);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'liquidation-bot',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Vault endpoints
app.get('/vault/metrics', (req: Request, res: Response) => {
  try {
    const metrics = vaultService.getMetrics();
    res.json(metrics);
  } catch (error: any) {
    logger.error('Error fetching vault metrics', { error });
    res.status(500).json({ error: error.message });
  }
});

app.get('/vault/investors', (req: Request, res: Response) => {
  try {
    const investors = vaultService.getAllInvestors();
    res.json(investors);
  } catch (error: any) {
    logger.error('Error fetching investors', { error });
    res.status(500).json({ error: error.message });
  }
});

app.get('/vault/investor/:address', (req: Request, res: Response) => {
  try {
    const investor = vaultService.getInvestor(req.params.address);
    if (!investor) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    res.json(investor);
  } catch (error: any) {
    logger.error('Error fetching investor', { error });
    res.status(500).json({ error: error.message });
  }
});

app.post('/vault/invest', async (req: Request, res: Response) => {
  try {
    const { userAddress, amount } = req.body;
    if (!userAddress || !amount) {
      return res.status(400).json({ error: 'Missing required fields: userAddress, amount' });
    }

    const shares = await vaultService.invest(userAddress, amount);
    res.json({
      success: true,
      shares,
      message: 'Investment successful',
    });
  } catch (error: any) {
    logger.error('Error processing investment', { error });
    res.status(400).json({ error: error.message });
  }
});

app.post('/vault/withdraw', async (req: Request, res: Response) => {
  try {
    const { userAddress, shareAmount } = req.body;
    if (!userAddress) {
      return res.status(400).json({ error: 'Missing required field: userAddress' });
    }

    const amount = await vaultService.withdraw(userAddress, shareAmount);
    res.json({
      success: true,
      amount,
      message: 'Withdrawal successful',
    });
  } catch (error: any) {
    logger.error('Error processing withdrawal', { error });
    res.status(400).json({ error: error.message });
  }
});

// Control endpoints
app.post('/polling/start', (req: Request, res: Response) => {
  try {
    polling.start();
    res.json({ success: true, message: 'Polling started' });
  } catch (error: any) {
    logger.error('Error starting polling', { error });
    res.status(500).json({ error: error.message });
  }
});

app.post('/polling/stop', (req: Request, res: Response) => {
  try {
    polling.stop();
    res.json({ success: true, message: 'Polling stopped' });
  } catch (error: any) {
    logger.error('Error stopping polling', { error });
    res.status(500).json({ error: error.message });
  }
});

// Start server
const server = app.listen(config.port, () => {
  logger.info('Liquidation Bot Service started', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    vaultEnabled: config.vaultEnabled,
    cdpEnabled: config.enableCdpLiquidations,
    lendingEnabled: config.enableLendingLiquidations,
  });

  // Start polling automatically
  polling.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  polling.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  polling.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
