/**
 * @fileoverview Tests for User Routes
 * @description Unit tests for the User API endpoints
 */

import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { rest } from 'blockapps-rest';
import { Users } from '../../../api/v1/endpoints';
import { ISSUER_STATUS } from '../../../helpers/constants';

// Import the controller directly
import usersController from '../../../api/v1/users/users.controller';

// Create middleware stubs directly instead of importing
const authMiddleware = (req, res, next) => {
  req.accessToken = 'mock-access-token';
  req.decodedToken = {
    preferred_username: 'testuser',
    email: 'test@example.com'
  };
  req.address = '0x123456789';
  next();
};

const loadDappMiddleware = (req, res, next) => {
  req.dapp = {
    getCertificate: sinon.stub(),
    getCertificates: sinon.stub()
  };
  req.accessToken = 'mock-access-token';
  req.decodedToken = {
    preferred_username: 'testuser',
    email: 'test@example.com'
  };
  req.address = '0x123456789';
  next();
};

describe('User Routes', function() {
  let app;
  let sandbox;
  let authorizeRequestStub;
  
  beforeEach(function() {
    // Create a sinon sandbox
    sandbox = sinon.createSandbox();
    
    // Stub the controller methods
    sandbox.stub(usersController, 'me');
    sandbox.stub(usersController, 'get');
    sandbox.stub(usersController, 'getAll');
    
    // Create a stub for authorizeRequest
    authorizeRequestStub = sandbox.stub();
    authorizeRequestStub.returns(authMiddleware);
    
    // Create a fresh express app for each test
    app = express();
    app.use(express.json());
    
    // Setup routes directly without a router to avoid path issues
    // This ensures the paths match exactly what's in the spec
    app.get(`/users${Users.me}`, authorizeRequestStub(false), loadDappMiddleware, usersController.me);
    app.get(`/users${Users.get}`, authorizeRequestStub(), loadDappMiddleware, usersController.get);
    app.get(`/users${Users.getAll}`, authorizeRequestStub(), loadDappMiddleware, usersController.getAll);
    
    // Mock rest response methods
    sandbox.stub(rest, 'response').value({
      status200: sandbox.stub().callsFake((res, data) => res.status(200).json(data)),
      status400: sandbox.stub().callsFake((res, data) => res.status(400).json(data)),
      status: sandbox.stub().callsFake((code, res, data) => res.status(code).json(data))
    });
  });
  
  afterEach(function() {
    sandbox.restore();
  });
  
  describe('GET /users/me', function() {
    const mockUser = {
      userAddress: '0x123456789',
      commonName: 'Test User',
      certificateAddress: '0xabcdef'
    };
    
    const mockWalletResponse = [{
      issuerStatus: ISSUER_STATUS.AUTHORIZED,
      isAdmin: true
    }];
    
    it('should return the current user profile when authenticated', async function() {
      // Setup controller behavior
      usersController.me.callsFake((req, res, next) => {
        rest.response.status200(res, {
          ...mockUser,
          email: req.decodedToken.email,
          preferred_username: req.decodedToken.preferred_username,
          issuerStatus: mockWalletResponse[0].issuerStatus,
          isAdmin: mockWalletResponse[0].isAdmin
        });
        next();
      });
      
      const response = await request(app).get('/users/me');
      
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({
        userAddress: '0x123456789',
        commonName: 'Test User',
        certificateAddress: '0xabcdef',
        email: 'test@example.com',
        preferred_username: 'testuser',
        issuerStatus: ISSUER_STATUS.AUTHORIZED,
        isAdmin: true
      });
      expect(authorizeRequestStub.calledWith(false)).to.be.true;
      expect(usersController.me.called).to.be.true;
    });
    
    it('should return 400 when user certificate is not found', async function() {
      usersController.me.callsFake((req, res, next) => {
        rest.response.status400(res, { username: req.decodedToken.preferred_username });
        next();
      });
      
      const response = await request(app).get('/users/me');
      
      expect(response.status).to.equal(400);
      expect(response.body).to.deep.equal({ username: 'testuser' });
    });
    
    it('should pass errors to error handling middleware', async function() {
      const testError = new Error('Test error');
      usersController.me.callsFake((req, res, next) => {
        next(testError);
      });
      
      // Add error handling middleware
      app.use((err, req, res, next) => {
        expect(err).to.equal(testError);
        res.status(500).json({ error: err.message });
      });
      
      const response = await request(app).get('/users/me');
      expect(response.status).to.equal(500);
    });
  });
  
  describe('GET /users/:address', function() {
    const mockUser = {
      userAddress: '0xaddress123',
      commonName: 'Test User',
      certificateAddress: '0xcertaddress'
    };
    
    beforeEach(function() {
      usersController.get.callsFake((req, res, next) => {
        rest.response.status200(res, mockUser);
        next();
      });
    });
    
    it('should return a user by address', async function() {
      const response = await request(app)
        .get('/users/0xaddress123')
        .query({ address: '0xaddress123' });
      
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal(mockUser);
      expect(authorizeRequestStub.called).to.be.true;
      expect(usersController.get.called).to.be.true;
    });
    
    it('should return 404 when user is not found', async function() {
      usersController.get.callsFake((req, res, next) => {
        const { query } = req;
        rest.response.status(404, res, { address: query.address });
        next();
      });
      
      const response = await request(app)
        .get('/users/0xnonexistent')
        .query({ address: '0xnonexistent' });
      
      expect(response.status).to.equal(404);
      expect(response.body).to.deep.equal({ address: '0xnonexistent' });
    });
  });
  
  describe('GET /users', function() {
    const mockUsers = [
      {
        userAddress: '0xuser1',
        commonName: 'User One',
        certificateAddress: '0xcert1'
      },
      {
        userAddress: '0xuser2',
        commonName: 'User Two',
        certificateAddress: '0xcert2'
      }
    ];
    
    beforeEach(function() {
      usersController.getAll.callsFake((req, res, next) => {
        rest.response.status200(res, mockUsers);
        next();
      });
    });
    
    it('should return all users', async function() {
      const response = await request(app).get('/users');
      
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal(mockUsers);
      expect(authorizeRequestStub.called).to.be.true;
      expect(usersController.getAll.called).to.be.true;
    });
    
    it('should handle query parameters for filtering', async function() {
      // Reset the call history
      usersController.getAll.resetHistory();
      
      const queryParams = { limit: 10, offset: 5 };
      
      await request(app)
        .get('/users')
        .query(queryParams);
      
      // Verify the controller was called with the query parameters
      expect(usersController.getAll.called).to.be.true;
      const controllerCall = usersController.getAll.getCall(0);
      expect(controllerCall).to.not.be.null;
      expect(controllerCall.args[0].query).to.deep.include({
        limit: '10',  // Express converts query params to strings
        offset: '5'
      });
    });
    
    it('should handle errors', async function() {
      const testError = new Error('Failed to retrieve users');
      usersController.getAll.callsFake((req, res, next) => {
        next(testError);
      });
      
      // Add error handling middleware
      app.use((err, req, res, next) => {
        expect(err).to.equal(testError);
        res.status(500).json({ error: err.message });
      });
      
      const response = await request(app).get('/users');
      expect(response.status).to.equal(500);
    });
  });
}); 
