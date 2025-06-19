import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import expressWinston from 'express-winston';
import winston from 'winston';
import constants from './helpers/constants';
import routes from './api/v1/routes';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fsUtil, assert } from 'blockapps-rest';
import ErrorHandlers from './api/middleware/errorHandler';
import config from './load.config';
import authHandler from './api/middleware/authHandler';
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './swaggerspecs';
import dotenv from 'dotenv';
import websocket from './websocket';
import axios from 'axios';
import { cronSyncCall } from './helpers/cronSyncCall';
import cronFunc from './cron';
import jwtDecode from 'jwt-decode';
const isLocalHost = config.serverHost === constants.localHost;

let server;
(async () => {
  const app = express();

  const { baseUrl, deployParamName } = constants;

  // Load deploy file
  const deploy = fsUtil.getYaml(
    `${config.configDirPath}/${config.deployFilename}`
  );
  if (!deploy) {
    throw new Error(
      `Deploy file '${config.configDirPath}/${config.deployFilename}' not found`
    );
  }

  const marketplaceUrl = `${config.serverHost}`;
  axios.defaults.headers.common['Referer'] = marketplaceUrl;

  app.set(deployParamName, deploy);

  // Setup middleware
  app.use('/', express.static('./public'));
  app.use(helmet());
  app.use(cors());
  app.use(bodyParser.json());
  app.use(cookieParser());

  // Setup logging
  app.use(
    expressWinston.logger({
      transports: [new winston.transports.Console()],
      meta: false,
      expressFormat: true,
      dynamicMeta: (req, res) => {
        let token;
        try {
          token = jwtDecode(req.headers['x-user-access-token']);
        } catch (err) {
          token = null;
          console.warn('Failed to decode token:', err);
        }

        return {
          userAgent: req.headers['user-agent'],
          cfIp:
            req.headers['cf-connecting-ip'] ||
            req.headers['cf-connecting-ipv6'],
          xForwardedFor: req.headers['x-forwarded-for'],
          referrer: req.headers['referer'] || req.headers['referrer'],
          user: token?.preferred_username
            ? token.preferred_username
            : token?.email
              ? token.email
              : '',
        };
      },
    })
  );

  try {
    app.oauth = await authHandler.initOauth();
  } catch (e) {
    console.error('Error initializing the oauthHandler', e);
    throw e;
  }
  // Setup routes
  app.use(`${baseUrl}`, routes);

  app.use(ErrorHandlers.clientErrorHandler);
  app.use(ErrorHandlers.commonErrorHandler);

  // Start the server
  const port = process.env.PORT || 3030;
  server = app.listen(port, () => console.log(`Listening on ${port}`));
  websocket(server);

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

  if (isLocalHost) {
    cronFunc();
  } else {
    cronSyncCall();
  }
})();

export default server;
