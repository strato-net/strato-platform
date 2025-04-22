import { expect } from 'chai';
import sinon from 'sinon';
import { rest } from 'blockapps-rest';
import config from '/load.config';
import axios from 'axios';
import proxyquire from 'proxyquire';

// Import oauthHelper directly
import oauthHelper from '/helpers/oauthHelper';

describe('Authentication Middleware', () => {
  let sandbox;
  let req;
  let res;
  let next;
  let mockToken;
  let mockDecodedToken;
  let mockAddress;
  let mockOauth;
  let jwtDecodeStub;
  let AuthHandler;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    mockToken = 'mock-jwt-token';
    mockDecodedToken = {
      preferred_username: 'testuser',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    mockAddress = '0x1234567890abcdef';
    
    // Create jwt-decode stub
    jwtDecodeStub = sandbox.stub().returns(mockDecodedToken);
    
    // Use proxyquire to create a version of AuthHandler with mocked dependencies
    AuthHandler = proxyquire('../../api/middleware/authHandler', {
      'jwt-decode': jwtDecodeStub
    }).default;
    
    // Mock OAuth object
    mockOauth = {
      getCookieNameAccessToken: sandbox.stub().returns('access_token'),
      getCookieNameAccessTokenExpiry: sandbox.stub().returns('access_token_expiry'),
      getCookieNameRefreshToken: sandbox.stub().returns('refresh_token'),
      getSigninURL: sandbox.stub().returns('https://oauth-provider.com/login'),
      validateAndGetNewToken: sandbox.stub().resolves(mockToken),
    };
    
    // Mock request, response and next
    req = {
      cookies: {},
      headers: {},
      app: {
        oauth: mockOauth,
        get: sandbox.stub(),
      },
    };
    
    res = {
      cookie: sandbox.stub(),
      clearCookie: sandbox.stub(),
      status: sandbox.stub().returns({
        json: sandbox.stub().returns({}),
      }),
    };
    
    next = sandbox.stub();
    
    // Mock rest functions
    sandbox.stub(rest, 'createOrGetKey').resolves(mockAddress);
    sandbox.stub(rest, 'getKey').resolves(mockAddress);
    sandbox.stub(rest.response, 'status').callsFake((status, res, data) => {
      return res.status(status).json(data);
    });
    
    // Mock axios for health check
    sandbox.stub(axios, 'get').resolves({ data: { health: true } });
    
    // Mock oauthHelper
    sandbox.stub(oauthHelper, 'getServiceToken').resolves(mockToken);
    sandbox.stub(oauthHelper, 'getUserToken').resolves(mockToken);
    
    // Set environment variables
    process.env.GLOBAL_ADMIN_NAME = 'admin';
    process.env.GLOBAL_ADMIN_PASSWORD = 'password';
    
    // Reset config.dockerized for tests
    config.dockerized = false;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('authorizeRequest', () => {
    // SUCCESS PATHS
    it('should authorize requests with valid token in cookie', async () => {
      // Setup token in cookie
      req.cookies['access_token'] = mockToken;
      
      const middleware = AuthHandler.authorizeRequest();
      await middleware(req, res, next);
      
      // Log for debugging
      console.log('req.address:', req.address);
      console.log('createOrGetKey called:', rest.createOrGetKey.called);
      console.log('jwtDecode called:', jwtDecodeStub.called);
      
      // Assertions
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.createOrGetKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(req.address).to.equal(mockAddress);
      expect(req.accessToken).to.deep.equal({ token: mockToken });
      expect(req.decodedToken).to.deep.equal(mockDecodedToken);
      expect(req.username).to.equal(mockDecodedToken.preferred_username);
      expect(mockOauth.validateAndGetNewToken.calledOnce).to.be.true;
    });
    
    it('should authorize requests with valid token in Authorization header', async () => {
      // Setup token in Authorization header
      req.headers['authorization'] = `Bearer ${mockToken}`;
      
      const middleware = AuthHandler.authorizeRequest();
      await middleware(req, res, next);
      
      // Assertions
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.createOrGetKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(req.address).to.equal(mockAddress);
      expect(req.accessToken).to.deep.equal({ token: mockToken });
      expect(req.decodedToken).to.deep.equal(mockDecodedToken);
      expect(req.username).to.equal(mockDecodedToken.preferred_username);
    });
    
    it('should authorize requests with custom header x-user-access-token', async () => {
      // Setup token in custom header
      req.headers['x-user-access-token'] = mockToken;
      
      const middleware = AuthHandler.authorizeRequest();
      await middleware(req, res, next);
      
      // Assertions
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.createOrGetKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(req.address).to.equal(mockAddress);
      expect(req.accessToken).to.deep.equal({ token: mockToken });
      expect(req.decodedToken).to.deep.equal(mockDecodedToken);
      expect(req.username).to.equal(mockDecodedToken.preferred_username);
    });
    
    it('should get service token for anonymous access when allowed', async () => {
      // No token in cookie or header, but anonymous access allowed
      const middleware = AuthHandler.authorizeRequest(true);
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getServiceToken.calledOnce).to.be.true;
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.createOrGetKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(req.address).to.equal(mockAddress);
      expect(req.accessToken).to.deep.equal({ token: mockToken });
      expect(req.decodedToken).to.deep.equal(mockDecodedToken);
      expect(req.username).to.equal('serviceUser');
    });
    
    // ERROR PATHS
    it('should return 401 Unauthorized when no token is found and anonymous access is not allowed', async () => {
      // No token in cookie or header
      const middleware = AuthHandler.authorizeRequest(false); // Don't allow anonymous access
      await middleware(req, res, next);
      
      // Assertions
      expect(res.clearCookie.callCount).to.equal(3);
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(401); // Unauthorized
      expect(rest.response.status.firstCall.args[2]).to.deep.equal({
        loginUrl: 'https://oauth-provider.com/login'
      });
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.be.an('error');
      expect(next.firstCall.args[0].message).to.equal('Authorization required');
    });
    
    it('should return 500 Internal Server Error when server health check fails', async () => {
      // Reset axios.get to return unhealthy status
      axios.get.resolves({ data: { health: false } });
      
      // No token in cookie or header
      const middleware = AuthHandler.authorizeRequest(false); // Don't allow anonymous access
      await middleware(req, res, next);
      
      // Assertions
      expect(axios.get.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(500); // Internal Server Error
      expect(rest.response.status.firstCall.args[2]).to.equal('Internal Server Error 101');
    });
    
    it('should return 400 Bad Request when token is not a valid JWT', async () => {
      // Setup token in cookie
      req.cookies['access_token'] = mockToken;
      
      // Make JWT decode throw an error
      jwtDecodeStub.throws(new Error('Invalid token'));
      
      const middleware = AuthHandler.authorizeRequest();
      await middleware(req, res, next);
      
      // Assertions
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(400); // Bad Request
      expect(rest.response.status.firstCall.args[2]).to.equal('Access token is not a valid JWT');
      expect(next.calledOnce).to.be.true;
    });
    
    it('should handle errors from STRATO API', async () => {
      // Setup token in cookie
      req.cookies['access_token'] = mockToken;
      
      // Make createOrGetKey throw an error
      rest.createOrGetKey.rejects(new Error('STRATO API error'));
      
      const middleware = AuthHandler.authorizeRequest();
      await middleware(req, res, next);
      
      // Assertions
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(500); // Internal Server Error
      expect(rest.response.status.firstCall.args[2]).to.equal('Internal Server Error 101');
    });
  });
  
  describe('getDeployersTokenForWebhook', () => {
    it('should get admin token and set user info for webhooks', async () => {
      const middleware = AuthHandler.getDeployersTokenForWebhook();
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getUserToken.calledOnce).to.be.true;
      expect(oauthHelper.getUserToken.calledWith(
        process.env.GLOBAL_ADMIN_NAME,
        process.env.GLOBAL_ADMIN_PASSWORD
      )).to.be.true;
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.getKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(req.address).to.equal(mockAddress);
      expect(req.accessToken).to.deep.equal({ token: mockToken });
      expect(req.decodedToken).to.deep.equal(mockDecodedToken);
      expect(req.username).to.equal(mockDecodedToken.preferred_username);
    });
    
    it('should handle errors when admin user is not created in STRATO', async () => {
      // Make getKey throw a 400 error
      const error = new Error('User not created');
      error.response = { status: 400 };
      rest.getKey.rejects(error);
      
      const middleware = AuthHandler.getDeployersTokenForWebhook();
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getUserToken.calledOnce).to.be.true;
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.getKey.calledOnce).to.be.true;
      expect(next.calledOnce).to.be.true;
      expect(next.calledWith(error)).to.be.true;
    });
    
    it('should handle errors with invalid JWT tokens', async () => {
      // Make JWT decode throw an error
      jwtDecodeStub.throws(new Error('Invalid token'));
      
      const middleware = AuthHandler.getDeployersTokenForWebhook();
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getUserToken.calledOnce).to.be.true;
      expect(jwtDecodeStub.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(400); // Bad Request
      expect(rest.response.status.firstCall.args[2]).to.equal('Access token is not a valid JWT');
      expect(next.calledOnce).to.be.true;
    });
    
    it('should handle errors when getting admin token fails', async () => {
      // Make getUserToken throw an error
      oauthHelper.getUserToken.rejects(new Error('Token error'));
      
      const middleware = AuthHandler.getDeployersTokenForWebhook();
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getUserToken.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(500); // Internal Server Error
      expect(next.calledOnce).to.be.true;
    });
    
    it('should return 401 Unauthorized when token acquisition fails', async () => {
      // Make getUserToken resolve with null (no token acquired)
      oauthHelper.getUserToken.resolves(null);
      
      const middleware = AuthHandler.getDeployersTokenForWebhook();
      await middleware(req, res, next);
      
      // Assertions
      expect(oauthHelper.getUserToken.calledOnce).to.be.true;
      expect(rest.response.status.calledOnce).to.be.true;
      expect(rest.response.status.firstCall.args[0]).to.equal(401); // Unauthorized
      expect(next.calledOnce).to.be.true;
    });
  });
  
  describe('initOauth', () => {
    it('should successfully initialize OAuth', async () => {
      // Create mock for oauthUtil
      const oauthUtilStub = { init: sandbox.stub().resolves(mockOauth) };
      
      // Create a version of AuthHandler with mocked oauthUtil
      const AuthHandlerWithMock = proxyquire('../../api/middleware/authHandler', {
        'jwt-decode': jwtDecodeStub,
        'blockapps-rest': { 
          rest: { ...rest },
          oauthUtil: oauthUtilStub
        }
      }).default;
      
      // Mock config nodes
      const originalNodes = config.nodes;
      config.nodes = [{ oauth: { /* mock settings */ } }];
      
      try {
        // Call the method under test
        const result = await AuthHandlerWithMock.initOauth();
        
        // Assertions
        expect(oauthUtilStub.init.calledOnce).to.be.true;
        expect(oauthUtilStub.init.calledWith(config.nodes[0].oauth)).to.be.true;
        expect(result).to.equal(mockOauth);
      } finally {
        // Restore config
        config.nodes = originalNodes;
      }
    });
    
    it('should handle errors during OAuth initialization', async () => {
      // Save original process.exit to restore later
      const originalExit = process.exit;
      
      // Create mock for oauthUtil that throws an error
      const oauthUtilStub = { 
        init: sandbox.stub().rejects(new Error('OAuth init failed')) 
      };
      
      // Create a version of AuthHandler with mocked oauthUtil
      const AuthHandlerWithMock = proxyquire('../../api/middleware/authHandler', {
        'jwt-decode': jwtDecodeStub,
        'blockapps-rest': { 
          rest: { ...rest },
          oauthUtil: oauthUtilStub
        }
      }).default;
      
      try {
        // Mock process.exit to prevent test from actually exiting
        process.exit = sandbox.stub();
        
        // Call the method under test
        await AuthHandlerWithMock.initOauth();
        
        // Assertions
        expect(oauthUtilStub.init.calledOnce).to.be.true;
        expect(process.exit.calledOnce).to.be.true;
        expect(process.exit.calledWith(1)).to.be.true;
      } finally {
        // Restore original process.exit
        process.exit = originalExit;
      }
    });
  });
}); 
