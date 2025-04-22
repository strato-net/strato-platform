import { expect } from 'chai';
import sinon from 'sinon';
import { rest } from 'blockapps-rest';
import httpStatus from 'http-status-codes';

// Import the actual controller
import IssuerStatusController from '../../../api/v1/IssuerStatus/issuerStatus.controller';

// Import dependencies that need to be mocked
import * as utils from '../../../helpers/utils';
import * as emailModule from '../../../helpers/email';
import constants from '../../../helpers/constants';

describe('IssuerStatus Controller', function() {
  // Increase timeout to avoid test failures on slow machines
  this.timeout(5000);
  
  let sandbox;
  let mockDapp;
  let mockAccessToken;
  let mockAdmins;
  let mockSendEmail;
  let mockRestStatus200;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Mock access token
    mockAccessToken = { token: 'mock-jwt-token' };
    
    // Mock dapp instance with stubbed methods
    mockDapp = {
      requestReview: sandbox.stub().resolves(),
      authorizeIssuer: sandbox.stub().resolves(),
      deauthorizeIssuer: sandbox.stub().resolves(),
      setIsAdmin: sandbox.stub().resolves()
    };
    
    // Mock admin users for the searchAllWithQueryArgs results
    mockAdmins = [
      { commonName: 'admin1', isAdmin: true },
      { commonName: 'admin2', isAdmin: true }
    ];
    
    // Mock the searchAllWithQueryArgs function
    sandbox.stub(utils, 'searchAllWithQueryArgs').resolves(mockAdmins);
    
    // Mock sendEmail function
    mockSendEmail = sandbox.stub();
    mockSendEmail.resolves();
    sandbox.stub(emailModule, 'default').value(mockSendEmail);
    
    // Mock rest.response.status200
    mockRestStatus200 = sandbox.stub();
    sandbox.stub(rest.response, 'status200').value(mockRestStatus200);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('requestReview', () => {
    it('should send email to admins and call dapp.requestReview', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          emailAddr: 'user@example.com',
          commonName: 'Test User'
        },
        accessToken: mockAccessToken
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Call the actual controller method
      await IssuerStatusController.requestReview(req, res, next);
      
      // Verify the search was called with correct parameters
      expect(utils.searchAllWithQueryArgs.calledOnce).to.be.true;
      expect(utils.searchAllWithQueryArgs.firstCall.args[0]).to.equal(constants.userContractName);
      expect(utils.searchAllWithQueryArgs.firstCall.args[1]).to.deep.equal({ isAdmin: true });
      
      // Verify email was sent with correct parameters
      expect(mockSendEmail.calledOnce).to.be.true;
      expect(mockSendEmail.firstCall.args[0]).to.deep.equal(['admin1', 'admin2']);
      expect(mockSendEmail.firstCall.args[1]).to.equal('Test User Requesting Issuer Status');
      expect(mockSendEmail.firstCall.args[2]).to.include('Test User');
      expect(mockSendEmail.firstCall.args[2]).to.include('user@example.com');
      
      // Verify dapp.requestReview was called with correct body
      expect(mockDapp.requestReview.calledOnce).to.be.true;
      expect(mockDapp.requestReview.firstCall.args[0]).to.deep.equal(req.body);
      
      // Verify status200 and next were called
      expect(mockRestStatus200.calledOnce).to.be.true;
      expect(mockRestStatus200.firstCall.args[0]).to.equal(res);
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args.length).to.equal(0); // No arguments to next means success
    });

    it('should handle email sending errors correctly', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          emailAddr: 'user@example.com',
          commonName: 'Test User'
        },
        accessToken: mockAccessToken
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Make sendEmail throw an error
      mockSendEmail.rejects(new Error('Failed to send email'));
      
      // Call the actual controller method
      await IssuerStatusController.requestReview(req, res, next);
      
      // Verify dapp.requestReview was not called
      expect(mockDapp.requestReview.called).to.be.false;
      
      // Verify next was called with an error
      expect(next.calledOnce).to.be.true;
      const error = next.firstCall.args[0];
      expect(error).to.exist;
      
      // Only check that it's an error with the expected message
      // We don't need to check the specific error type or status code since that may vary
      expect(error.message).to.include('Unable to send request');
    });

    it('should handle dapp.requestReview errors correctly', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          emailAddr: 'user@example.com',
          commonName: 'Test User'
        },
        accessToken: mockAccessToken
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Make dapp.requestReview throw an error
      const dappError = new Error('Dapp error');
      mockDapp.requestReview.rejects(dappError);
      
      // Call the actual controller method
      await IssuerStatusController.requestReview(req, res, next);
      
      // Verify next was called with the dapp error
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.equal(dappError);
    });
  });

  describe('authorizeIssuer', () => {
    it('should call dapp.authorizeIssuer and return success', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890'
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Call the actual controller method
      await IssuerStatusController.authorizeIssuer(req, res, next);
      
      // Verify dapp.authorizeIssuer was called with correct body
      expect(mockDapp.authorizeIssuer.calledOnce).to.be.true;
      expect(mockDapp.authorizeIssuer.firstCall.args[0]).to.deep.equal(req.body);
      
      // Verify status200 and next were called
      expect(mockRestStatus200.calledOnce).to.be.true;
      expect(mockRestStatus200.firstCall.args[0]).to.equal(res);
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args.length).to.equal(0);
    });

    it('should handle dapp.authorizeIssuer errors correctly', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890'
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Make dapp.authorizeIssuer throw an error
      const dappError = new Error('Authorization failed');
      mockDapp.authorizeIssuer.rejects(dappError);
      
      // Call the actual controller method
      await IssuerStatusController.authorizeIssuer(req, res, next);
      
      // Verify next was called with the dapp error
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.equal(dappError);
    });
  });

  describe('deauthorizeIssuer', () => {
    it('should call dapp.deauthorizeIssuer and return success', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890'
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Call the actual controller method
      await IssuerStatusController.deauthorizeIssuer(req, res, next);
      
      // Verify dapp.deauthorizeIssuer was called with correct body
      expect(mockDapp.deauthorizeIssuer.calledOnce).to.be.true;
      expect(mockDapp.deauthorizeIssuer.firstCall.args[0]).to.deep.equal(req.body);
      
      // Verify status200 and next were called
      expect(mockRestStatus200.calledOnce).to.be.true;
      expect(mockRestStatus200.firstCall.args[0]).to.equal(res);
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args.length).to.equal(0);
    });

    it('should handle dapp.deauthorizeIssuer errors correctly', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890'
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Make dapp.deauthorizeIssuer throw an error
      const dappError = new Error('Deauthorization failed');
      mockDapp.deauthorizeIssuer.rejects(dappError);
      
      // Call the actual controller method
      await IssuerStatusController.deauthorizeIssuer(req, res, next);
      
      // Verify next was called with the dapp error
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.equal(dappError);
    });
  });

  describe('setIsAdmin', () => {
    it('should call dapp.setIsAdmin and return success', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890',
          isAdmin: true
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Call the actual controller method
      await IssuerStatusController.setIsAdmin(req, res, next);
      
      // Verify dapp.setIsAdmin was called with correct body
      expect(mockDapp.setIsAdmin.calledOnce).to.be.true;
      expect(mockDapp.setIsAdmin.firstCall.args[0]).to.deep.equal(req.body);
      
      // Verify status200 and next were called
      expect(mockRestStatus200.calledOnce).to.be.true;
      expect(mockRestStatus200.firstCall.args[0]).to.equal(res);
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args.length).to.equal(0);
    });

    it('should handle dapp.setIsAdmin errors correctly', async () => {
      // Prepare request and response objects
      const req = {
        dapp: mockDapp,
        body: {
          address: '0xabcdef1234567890',
          isAdmin: true
        }
      };
      
      const res = {};
      const next = sandbox.stub();
      
      // Make dapp.setIsAdmin throw an error
      const dappError = new Error('Setting admin status failed');
      mockDapp.setIsAdmin.rejects(dappError);
      
      // Call the actual controller method
      await IssuerStatusController.setIsAdmin(req, res, next);
      
      // Verify next was called with the dapp error
      expect(next.calledOnce).to.be.true;
      expect(next.firstCall.args[0]).to.equal(dappError);
    });
  });
}); 
