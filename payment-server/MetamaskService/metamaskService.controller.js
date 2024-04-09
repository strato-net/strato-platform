class MetamaskServiceController {
    // static async metamaskOnboarding(req, res, next) {
    //   try {
    //     const { commonName, walletAddress } = req.body;
    //     if (!walletAddress || !commonName) {
    //       throw new Error(
    //         "Missing wallet address or common name in POST request /onboard"
    //       );
    //     }
    //     const query = `
    //       INSERT INTO metamask_wallet (
    //         commonName,
    //         walletAddress
    //       ) VALUES (
    //         $1, $2
    //       ) RETURNING id;`;
  
    //     const values = [commonName, walletAddress];
  
    //     const result = await client.query(query, values);
  
    //     const id = result.rows[0].id;
  
    //     res.status(200).json({
    //       message: "success",
    //       id: id,
    //     });
  
    //     return next();
    //   } catch (error) {
    //     console.error("DB Error:", error.message);
    //     next(error);
    //   }
    // }
  
    // static async metamaskConnectStatus(req, res, next) {
    //   try {
    //     if (!req.params.commonName) {
    //       throw new Error(
    //         "Missing common name in GET request /status/:commonName"
    //       );
    //     }
  
    //     const commonName = req.params.commonName;
    //     const query = `
    //       SELECT * FROM metamask_wallet WHERE commonName = $1`;
    //     const values = [commonName];
  
    //     const result = await client.query(query, values);
    //     res.status(200).json({
    //       message: "success",
    //       data: result.rows[0],
    //     });
    //     return next();
    //   } catch (e) {
    //     next(e);
    //   }
    // }
  }
  
  module.exports = MetamaskServiceController;