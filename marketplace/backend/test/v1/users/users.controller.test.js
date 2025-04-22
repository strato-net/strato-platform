/**
 * @fileoverview Tests for User Controller
 * @description Unit tests for the User controller methods
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { rest } from 'blockapps-rest';
import UsersController from '../../../api/v1/users/users.controller';
import { ISSUER_STATUS } from '../../../helpers/constants';
import * as utils from '../../../helpers/utils';

describe('UsersController', function() {
  let req, res, next;
  let sandbox;
  let pollingHelperStub, searchAllWithQueryArgsStub;
  
  beforeEach(function() {
    // Create a sinon sandbox for easy restoration
    sandbox = sinon.createSandbox();
    
    // Stub the utils functions directly instead of trying to stub module properties
    pollingHelperStub = sandbox.stub();
    searchAllWithQueryArgsStub = sandbox.stub();
    
    // Replace the module's functions with our stubs
    sandbox.stub(utils, 'pollingHelper').callsFake(pollingHelperStub);
    sandbox.stub(utils, 'searchAllWithQueryArgs').callsFake(searchAllWithQueryArgsStub);
    
    // Mock Express request, response, and next
    req = {
      dapp: {
        getCertificate: sandbox.stub(),
        getCertificates: sandbox.stub(),
      },
      accessToken: 'mock-access-token',
      decodedToken: {
        preferred_username: 'testuser',
        email: 'test@example.com',
      },
      address: '0x123456789',
      query: {},
    };
    
    res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub().returnsThis(),
    };
    
    next = sandbox.stub();
    
    // Mock rest response methods
    sandbox.stub(rest, 'response').value({
      status200: sandbox.stub().callsFake((res, data) => {
        res.status(200);
        res.json(data);
        return res;
      }),
      status400: sandbox.stub().callsFake((res, data) => {
        res.status(400);
        res.json(data);
        return res;
      }),
      status: sandbox.stub().callsFake((code, res, data) => {
        res.status(code);
        res.json(data);
        return res;
      }),
    });
  });
  
  afterEach(function() {
    // Restore all stubs
    sandbox.restore();
  });
  
  describe('me', function() {
    const mockUser = {
      userAddress: '0x123456789',
      commonName: 'Test User',
      certificateAddress: '0xabcdef',
    };
    
    const mockWalletResponse = [{
      issuerStatus: ISSUER_STATUS.AUTHORIZED,
      isAdmin: true,
    }];
    
    beforeEach(function() {
      pollingHelperStub.resolves(mockUser);
      searchAllWithQueryArgsStub.resolves(mockWalletResponse);
    });
    
    it('should return user profile with blockchain and token data when certificate is found', async function() {
      await UsersController.me(req, res, next);
      
      expect(pollingHelperStub.calledWith(req.dapp.getCertificate, [{ userAddress: req.address }])).to.be.true;
      expect(searchAllWithQueryArgsStub.called).to.be.true;
      expect(rest.response.status200.calledWith(res, {
        ...mockUser,
        email: req.decodedToken.email,
        preferred_username: req.decodedToken.preferred_username,
        issuerStatus: mockWalletResponse[0].issuerStatus,
        isAdmin: mockWalletResponse[0].isAdmin,
      })).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should return user profile directly if dapp.hasCert is available', async function() {
      req.dapp.hasCert = mockUser;
      
      await UsersController.me(req, res, next);
      
      expect(pollingHelperStub.called).to.be.false;
      expect(searchAllWithQueryArgsStub.called).to.be.true;
      expect(rest.response.status200.calledWith(res, {
        ...mockUser,
        email: req.decodedToken.email,
        preferred_username: req.decodedToken.preferred_username,
        issuerStatus: mockWalletResponse[0].issuerStatus,
        isAdmin: mockWalletResponse[0].isAdmin,
      })).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should return 400 when user certificate is not found', async function() {
      pollingHelperStub.resolves(null);
      
      await UsersController.me(req, res, next);
      
      expect(rest.response.status400.calledWith(res, { username: req.decodedToken.preferred_username })).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should handle case when wallet response is empty', async function() {
      searchAllWithQueryArgsStub.resolves([]);
      
      await UsersController.me(req, res, next);
      
      expect(rest.response.status200.calledWith(res, {
        ...mockUser,
        email: req.decodedToken.email,
        preferred_username: req.decodedToken.preferred_username,
        issuerStatus: ISSUER_STATUS.UNAUTHORIZED,
        isAdmin: false,
      })).to.be.true;
    });
    
    it('should pass errors to next middleware', async function() {
      const testError = new Error('Test error');
      pollingHelperStub.rejects(testError);
      
      await UsersController.me(req, res, next);
      
      expect(next.calledWith(testError)).to.be.true;
    });
  });
  
  describe('get', function() {
    const mockUser = {
      userAddress: '0xaddress123',
      commonName: 'Test User',
      certificateAddress: '0xcertaddress'
    };
    
    beforeEach(function() {
      req.query.address = '0xaddress123';
      req.dapp.getCertificate.resolves(mockUser);
    });
    
    it('should return user certificate by address', async function() {
      await UsersController.get(req, res, next);
      
      expect(req.dapp.getCertificate.calledWith({
        userAddress: req.query.address,
      })).to.be.true;
      expect(rest.response.status200.calledWith(res, mockUser)).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should return 404 when user is not found', async function() {
      req.dapp.getCertificate.resolves(null);
      
      await UsersController.get(req, res, next);
      
      expect(rest.response.status.calledWith(404, res, { address: req.query.address })).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should return 404 when user object is empty', async function() {
      req.dapp.getCertificate.resolves({});
      
      await UsersController.get(req, res, next);
      
      expect(rest.response.status.calledWith(404, res, { address: req.query.address })).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should pass errors to next middleware', async function() {
      const testError = new Error('Test error');
      req.dapp.getCertificate.rejects(testError);
      
      await UsersController.get(req, res, next);
      
      expect(next.calledWith(testError)).to.be.true;
    });
  });
  
  describe('getAll', function() {
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
      req.dapp.getCertificates.resolves(mockUsers);
    });
    
    it('should return all user certificates', async function() {
      await UsersController.getAll(req, res, next);
      
      expect(req.dapp.getCertificates.calledWith(req.query)).to.be.true;
      expect(rest.response.status200.calledWith(res, mockUsers)).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should pass query parameters to getCertificates', async function() {
      req.query = { limit: 10, offset: 5 };
      
      await UsersController.getAll(req, res, next);
      
      expect(req.dapp.getCertificates.calledWith(req.query)).to.be.true;
      expect(next.called).to.be.true;
    });
    
    it('should pass errors to next middleware', async function() {
      const testError = new Error('Failed to retrieve users');
      req.dapp.getCertificates.rejects(testError);
      
      await UsersController.getAll(req, res, next);
      
      expect(next.calledWith(testError)).to.be.true;
    });
  });
}); 
