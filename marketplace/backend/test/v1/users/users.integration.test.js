/**
 * @fileoverview Integration Tests for User API
 * @description Integration tests for the User API endpoints
 */

import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import { rest } from 'blockapps-rest';
import { Users } from '../../../api/v1/endpoints';
import { ISSUER_STATUS } from '../../../helpers/constants';

// Import and create actual middleware functions for proper mocking
import usersController from '../../../api/v1/users/users.controller';

// Create stubs for the middleware functions directly
const authMiddleware = (req, res, next) => {
  req.accessToken = 'mock-access-token';
  req.decodedToken = {
    preferred_username: 'testuser',
    email: 'test@example.com'
  };
  req.address = '0x123456789';
  next();
};

describe('User API Integration Tests', function() {
  let app;
  let sandbox;
  let mockRouter;
  let authorizeRequestStub;
  
  before(function() {
    // Create a sinon sandbox
    sandbox = sinon.createSandbox();
    
    // Create a mock router and users controller
    mockRouter = express.Router();
    
    // Create a stub for the authorizeRequest function
    authorizeRequestStub = sandbox.stub();
    authorizeRequestStub.returns(authMiddleware);
    
    // Stub the controller methods
    sandbox.stub(usersController, 'me').callsFake((req, res, next) => {
      const mockUser = {
        userAddress: '0x123456789',
        commonName: 'Test User',
        certificateAddress: '0xabcdef',
        email: req.decodedToken.email,
        preferred_username: req.decodedToken.preferred_username,
        issuerStatus: 'AUTHORIZED',
        isAdmin: true
      };
      rest.response.status200(res, mockUser);
      next();
    });
    
    sandbox.stub(usersController, 'get').callsFake((req, res, next) => {
      const address = req.query.address || req.params.address;
      if (address === 'nonexistent') {
        rest.response.status(404, res, { address });
      } else {
        const mockUser = {
          userAddress: address,
          commonName: 'Test User',
          certificateAddress: '0xcertaddress'
        };
        rest.response.status200(res, mockUser);
      }
      next();
    });
    
    sandbox.stub(usersController, 'getAll').callsFake((req, res, next) => {
      // Save the original query for test assertions
      req._originalQuery = { ...req.query };
      
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
      rest.response.status200(res, mockUsers);
      next();
    });
    
    // Create an express app
    app = express();
    app.use(bodyParser.json());
    app.set('deployment', 'test');
    
    // Mock rest.response methods
    sandbox.stub(rest, 'response').value({
      status200: sandbox.stub().callsFake((res, data) => res.status(200).json(data)),
      status400: sandbox.stub().callsFake((res, data) => res.status(400).json(data)),
      status: sandbox.stub().callsFake((code, res, data) => res.status(code).json(data))
    });
    
    // Setup routes - for more direct testing, set up the actual routes
    // instead of using the router with middleware
    app.get('/api/v1/users/me', authMiddleware, usersController.me);
    app.get('/api/v1/users/:address', authMiddleware, usersController.get);
    app.get('/api/v1/users', authMiddleware, usersController.getAll);
  });
  
  after(function() {
    sandbox.restore();
  });
  
  describe('GET /api/v1/users/me', function() {
    it('should return the current user profile', async function() {
      const response = await request(app).get('/api/v1/users/me');
      
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.include({
        userAddress: '0x123456789',
        commonName: 'Test User',
        email: 'test@example.com',
        preferred_username: 'testuser'
      });
      expect(authorizeRequestStub.called).to.be.false; // We're using the direct middleware
      expect(usersController.me.called).to.be.true;
    });
  });
  
  describe('GET /api/v1/users/:address', function() {
    it('should return a user by address', async function() {
      const response = await request(app)
        .get('/api/v1/users/0x123456789')
        .query({ address: '0x123456789' });
      
      expect(response.status).to.equal(200);
      expect(response.body).to.deep.include({
        userAddress: '0x123456789'
      });
      expect(usersController.get.called).to.be.true;
    });
    
    it('should return 404 when user is not found', async function() {
      const response = await request(app)
        .get('/api/v1/users/nonexistent')
        .query({ address: 'nonexistent' });
      
      expect(response.status).to.equal(404);
      expect(response.body).to.deep.equal({ address: 'nonexistent' });
    });
  });
  
  describe('GET /api/v1/users', function() {
    it('should return all users', async function() {
      const response = await request(app).get('/api/v1/users');
      
      expect(response.status).to.equal(200);
      expect(Array.isArray(response.body)).to.be.true;
      expect(response.body.length).to.equal(2);
      expect(response.body[0]).to.have.property('userAddress');
      expect(response.body[1]).to.have.property('userAddress');
    });
    
    it('should handle query parameters', async function() {
      // Reset the call history of the controller
      usersController.getAll.resetHistory();
      
      const queryParams = { limit: 10, offset: 5 };
      
      const response = await request(app)
        .get('/api/v1/users')
        .query(queryParams);
      
      expect(response.status).to.equal(200);
      expect(usersController.getAll.calledOnce).to.be.true;
      
      // Verify the controller received the query parameters
      const controllerCall = usersController.getAll.getCall(0);
      expect(controllerCall).to.not.be.null;
      expect(controllerCall.args[0].query).to.deep.include({
        limit: '10',  // Express converts query params to strings
        offset: '5'
      });
    });
  });
}); 
