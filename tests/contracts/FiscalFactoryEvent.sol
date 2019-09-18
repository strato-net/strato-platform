  /***************************************************************
  *                                                              *
  *      FISCAL FACTORY CONTRACT WITH GENERATOR FUNCTION         *
  *                                                              *
  ***************************************************************/

contract FiscalFactory {
    
    
    event FiscalEvent(
        string src_countryCode
        , string src_currencyCode
        , string src_phoneNumber
        , string src_taxCode
        , uint   src_latitude
        , uint   src_longitude
        , string dest_countryCode
        , string dest_currencyCode
        , string dest_phoneNumber
        , string dest_taxCode
        , uint   dest_latitude
        , uint   dest_longitude
        , string srcCryptoWallet
        , string destCryptoWalletCode
        , uint   amount
        , string datasetCode
        , string datasetSpecificFields_interest
        , string datasetSpecificFields_details
        , bool   fakeTransaction
    );

    
    function createFiscal( string src_countryCode
                       , string src_currencyCode
                       , string src_phoneNumber
                       , string src_taxCode
                       , uint   src_latitude
                       , uint   src_longitude
                       , string dest_countryCode
                       , string dest_currencyCode
                       , string dest_phoneNumber
                       , string dest_taxCode
                       , uint   dest_latitude
                       , uint   dest_longitude
                       , string srcCryptoWallet
                       , string destCryptoWalletCode
                       , uint   amount
                       , string datasetCode
                       , string datasetSpecificFields_interest
                       , string datasetSpecificFields_details
                       , bool   fakeTransaction
                       ) {


       emit FiscalEvent(
                  src_countryCode
                  , src_currencyCode
                  , src_phoneNumber
                  , src_taxCode
                  , src_latitude
                  , src_longitude
                  , dest_countryCode
                  , dest_currencyCode
                  , dest_phoneNumber
                  , dest_taxCode
                  , dest_latitude
                  , dest_longitude
                  , srcCryptoWallet
                  , destCryptoWalletCode
                  , amount
                  , datasetCode
                  , datasetSpecificFields_interest
                  , datasetSpecificFields_details
                  , fakeTransaction

        );

  } 

  function generateFiscal( string src_countryCode
                         , string src_currencyCode
                         , string src_phoneNumber
                         , string src_taxCode
                         , uint   src_latitude
                         , uint   src_longitude
                         , string dest_countryCode
                         , string dest_currencyCode
                         , string dest_phoneNumber
                         , string dest_taxCode
                         , uint   dest_latitude
                         , uint   dest_longitude
                         , string srcCryptoWallet
                         , string destCryptoWalletCode
                         , uint   amount
                         , string datasetCode
                         , string datasetSpecificFields_interest
                         , string datasetSpecificFields_details
                         , bool   fakeTransaction
                         , uint   copies
                         ) {
    for (uint i = 0; i < copies; i++) {
      createFiscal( src_countryCode
                  , src_currencyCode
                  , src_phoneNumber
                  , src_taxCode
                  , src_latitude
                  , src_longitude
                  , dest_countryCode
                  , dest_currencyCode
                  , dest_phoneNumber
                  , dest_taxCode
                  , dest_latitude
                  , dest_longitude
                  , srcCryptoWallet
                  , destCryptoWalletCode
                  , amount
                  , datasetCode
                  , datasetSpecificFields_interest
                  , datasetSpecificFields_details
                  , fakeTransaction
                  );
    }
  }
}
