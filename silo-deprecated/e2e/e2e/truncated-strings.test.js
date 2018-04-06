const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const should = common.should;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;

const testUser = new User(util.uid('test-user'));
const contract = new Contract('StringStorage', 'fixtures/StringStorage.sol');

describe('Setup ', function() {
	this.timeout(config.timeout);

	itShould.checkAvailability();

	itShould.createUser(testUser);

	itShould.importAndUploadBlob(testUser, contract);

	it('should have a valid contract address', function(done) {
	    assert.ok(util.isAddress(contract.address), 'should be a valid address ' + contract.address);
	    testFunction(0);
	    done();
	});
});

const input = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function testFunction(index) {
	describe('Truncated string issue for length ' + index, function(){
		this.timeout(config.timeout);

		var val = input.substring(0,index);

		const callSet = new Call('set', { value: val });
		itShould.callMethod(testUser, contract, callSet);
		it('should return null (success)', function(done) {
			assert.equal(callSet.result, 'null', 'method call result');
			checkResult(val, index);
			done();
		});

	});
}

function checkResult(val, index) {
	describe('Checking value ' + val, function(){
		itShould.getState(contract);
		it('should return valid result', function(done){
			try {
				assert.equal(contract.state.storedData, val, "should be equal");
				done();
			}
			catch(e) {
				done(e)
			}
			finally {
				if(index + 30 < input.length) {
				  testFunction(index + 30);
				}
			}
		});
	});
}
