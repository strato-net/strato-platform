contract Fiscal {
  
  struct Business {
    string countryCode;
    string currencyCode;
    string phoneNumber;
    string taxCode;
    uint latitude;
    uint longitude;
  }

  struct Dataset {
    string interest;
    string details;
  }

  Business _src;
  Business _dest;
  string _srcCryptoWallet;
  string _destCryptoWalletCode;
  uint _amount;
  string _datasetCode;
  Dataset _datasetSpecificFields;
  bool _fakeTransaction;

  constructor( string src_countryCode
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
    _src = Business( src_countryCode
                   , src_currencyCode
                   , src_phoneNumber
                   , src_taxCode
                   , src_latitude
                   , src_longitude
                   );
    _dest = Business( dest_countryCode
                    , dest_currencyCode
                    , dest_phoneNumber
                    , dest_taxCode
                    , dest_latitude
                    , dest_longitude
                    );
    _srcCryptoWallet = srcCryptoWallet;
    _destCryptoWalletCode = destCryptoWalletCode;
    _amount = amount;
    _datasetCode = datasetCode;
    _datasetSpecificFields = Dataset( datasetSpecificFields_interest
                                    , datasetSpecificFields_details
                                    );
    _fakeTransaction = fakeTransaction;
   }
}

  /***************************************************************
  *                                                              *
  *      FISCAL FACTORY CONTRACT WITH GENERATOR FUNCTION         *
  *                                                              *
  ***************************************************************/

contract FiscalFactory {

  event FiscalEvent(Fiscal x);

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
    Fiscal t = new Fiscal( src_countryCode
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

     emit FiscalEvent(t);
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
