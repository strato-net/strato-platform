import express from 'express';
import packageJson from '../../package.json';

import assetsRouter from './assets';
import authenticationRouter from './authentication';
import usersRouter from './users';

import { Authentication, Users, Assets } from './endpoints';

const router = express.Router();

// mount sub‑routers
router.use(Authentication.prefix, authenticationRouter);
router.use(Assets.prefix, assetsRouter);
router.use(Users.prefix, usersRouter);

// health check endpoint
router.get('/health', (_req, res) => {
    res.json({
        name: packageJson.name,
        version: packageJson.version,
        timestamp: new Date().toISOString(),
    });
});

export default router;