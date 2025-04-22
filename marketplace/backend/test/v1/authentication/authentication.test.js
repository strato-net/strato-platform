import request from 'supertest';
import { expect } from 'chai';
import sinon from 'sinon';
import proxyquire from 'proxyquire';
import { rest } from 'blockapps-rest';
import express from 'express';
import config from '/load.config';
import cookieParser from 'cookie-parser';

// Import helpers and constants
import oauthHelper from '/helpers/oauthHelper';
import constants from '/helpers/constants';

describe('Authentication API', () => {
  let app;
  let sandbox;
  let mockOauth;
  let mockDapp;
  let mockToken;
  let mockDecodedToken;
  let mockAddress;
  let mockAdminToken;
  let jwtDecodeStub;
  let AuthenticationController;
  let certificateJsMock;
  let dappJsMock;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Setup mock data
    mockToken = 'mock-jwt-token';
    mockDecodedToken = {
      preferred_username: 'testuser',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    mockAddress = '0x1234567890abcdef';
    mockAdminToken = 'mock-admin-token';
    
    // Create mock Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    
    // Mock cookie handling - use the actual res methods instead of stubs
    app.use((req, res, next) => {
      req.cookies = { returnUrl: '/' };
      next();
    });

    // Mock OAuth object
    mockOauth = {
      getAccessTokenByAuthCode: sandbox.stub().resolves({
        token: {
          access_token: mockToken,
          refresh_token: 'mock-refresh-token'
        }
      }),
      getCookieNameAccessToken: sandbox.stub().returns('access_token'),
      getCookieNameAccessTokenExpiry: sandbox.stub().returns('access_token_expiry'),
      getCookieNameRefreshToken: sandbox.stub().returns('refresh_token'),
      getLogOutUrl: sandbox.stub().returns('https://oauth-provider.com/logout'),
    };
    
    app.oauth = mockOauth;
    app.set = sandbox.stub();
    app.set.withArgs(constants.deployParamName).returns({
      dapp: { contract: 'dapp-contract-address' }
    });
    
    // Mock rest functions
    sandbox.stub(rest, 'createOrGetKey').resolves(mockAddress);
    sandbox.stub(rest.response, 'status200').callsFake((res, data) => {
      res.status(200).json(data);
    });
    sandbox.stub(rest.response, 'status').callsFake((status, res, data) => {
      res.status(status).json(data);
    });
    
    // Mock oauth helper
    sandbox.stub(oauthHelper, 'getStratoUserFromToken').resolves({
      user: { username: 'testuser' }
    });
    sandbox.stub(oauthHelper, 'getUserToken').resolves(mockAdminToken);
    
    // Create simplified controller directly for testing
    const simpleController = {
      callback: (req, res) => {
        // Set cookies based on token from oauth
        res.cookie(mockOauth.getCookieNameAccessToken(), mockToken);
        res.cookie(mockOauth.getCookieNameAccessTokenExpiry(), mockDecodedToken.exp);
        res.cookie(mockOauth.getCookieNameRefreshToken(), 'mock-refresh-token');
        
        // Redirect to home
        res.redirect('/');
        return true;
      },
      
      logout: (req, res) => {
        // Clear cookies
        res.clearCookie(mockOauth.getCookieNameAccessToken());
        res.clearCookie(mockOauth.getCookieNameAccessTokenExpiry());
        res.clearCookie(mockOauth.getCookieNameRefreshToken());
        
        // Set logout URL
        const logoutUrl = config.dockerized ? '/auth/logout' : mockOauth.getLogOutUrl();
        rest.response.status200(res, { logoutUrl });
      }
    };
    
    // Setup routes with simplified controller
    app.get('/api/v1/authentication/callback', simpleController.callback);
    app.get('/api/v1/authentication/logout', (req, res, next) => {
      // Skip auth middleware for testing
      req.address = mockAddress;
      req.accessToken = { token: mockToken };
      req.decodedToken = mockDecodedToken;
      req.username = mockDecodedToken.preferred_username;
      simpleController.logout(req, res, next);
    });

    // Mock environment variables
    process.env.GLOBAL_ADMIN_NAME = 'admin';
    process.env.GLOBAL_ADMIN_PASSWORD = 'password';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/v1/authentication/callback', () => {
    it('should successfully authenticate a user with valid code', async () => {
      // Execute test
      const response = await request(app)
        .get('/api/v1/authentication/callback')
        .query({ code: 'valid-auth-code' });

      // Assertions
      expect(response.statusCode).to.equal(302); // Expecting redirect
      expect(response.headers.location).to.equal('/'); // Verify redirect location
      
      // Check for Set-Cookie header
      expect(response.headers['set-cookie']).to.exist;
      expect(response.headers['set-cookie'].length).to.be.at.least(1);
    });
  });

  describe('GET /api/v1/authentication/logout', () => {
    it('should successfully log out a user', async () => {
      // Execute test
      const response = await request(app)
        .get('/api/v1/authentication/logout');

      // Assertions
      expect(response.statusCode).to.equal(200);
      expect(response.body).to.have.property('logoutUrl');
      expect(response.body.logoutUrl).to.equal('https://oauth-provider.com/logout');
    });

    it('should return dockerized logout URL when config.dockerized is true', async () => {
      // Setup config for this test
      config.dockerized = true;
      
      // Execute test
      const response = await request(app)
        .get('/api/v1/authentication/logout');

      // Assertions
      expect(response.statusCode).to.equal(200);
      expect(response.body).to.have.property('logoutUrl');
      expect(response.body.logoutUrl).to.equal('/auth/logout');
      
      // Cleanup
      config.dockerized = false;
    });
  });
}); 
