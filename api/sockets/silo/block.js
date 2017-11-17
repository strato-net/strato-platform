const Block = sequelize.define('block', {
  block_data: {
    type: Sequelize.CHAR
  },
  receipt_transactions: {
    type: Sequelize.CHAR
  },
  block_uncles: {
    type: Sequelize.CHAR
  }
});