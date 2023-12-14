class CustomerAddressController {

  static async getAddress(req, res, next) {
    try {
      res.status(200).send('TODO');
    } catch (e) {
      console.error(`${e}`);
      next(e);
    }
  }

  static async addAddress(req, res, next) {
    try {
      res.status(200).send('TODO');
    } catch (e) {
      console.error(`${e}`);
      next(e);
    }
  }

}

module.exports = CustomerAddressController;