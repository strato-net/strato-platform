
module.exports = {
  User: function(name, address) {
    this.name = name;
    this.address = address;
  },
  Contract: function(name, filename, args, txParams) {
    this.name = name;
    this.filename = filename;
    this.args = args || {};
    this.txParams = txParams || {};
    this.address = undefined;
    this.buffer = undefined;
    this.string = undefined;
    this.mapping = undefined;
    this.key = undefined;
    this.code = undefined;
    this.stateMap = undefined;
  },
  ContractSource : function(name, source) {
    this.name = name;
    this.source = source
  },
  ContractSources : function() {
    this.sources = [];
    this.results = undefined;
  },
  Import: function(name, solName, filename) {
    this.name = name;
    this.solName = solName;
    this.filename = filename;
    this.address = undefined;
    this.buffer = undefined;
    this.string = undefined;
  },
  Call: function(method, args, expected) {
    this.method = method;
    this.args = args || {};
    this.result = undefined;
    this.expected = expected;
  },
  Tx: function(fromUser, toUser, valueEther) {
    this.fromUser = fromUser;
    this.toUser = toUser;
    this.valueEther = valueEther;
    this.result = undefined;
    this.toString = function() {
      return 'from: ' + this.fromUser.name + ' to: ' + this.toUser.name + ' value (E): ' + this.valueEther;
    }
  },
  Storage: function(attr, value) {
    this.attr = attr;
    this.value = value;
    this.result = undefined;
  },
  Search: function(name) {
    this.name = name;
    this.addresses = undefined;
    this.states = undefined;
    this.well = undefined;
  },
};
