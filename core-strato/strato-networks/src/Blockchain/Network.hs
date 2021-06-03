
module Blockchain.Network where

import Blockchain.Strato.Model.Address

data PeerParams =
  NetworkParams {
    ethAddress::Address,
    webAddress::String
    }

getParams :: String -> IO (Maybe [PeerParams])
getParams "oldblockappsnet" = return $ Just
  [
    NetworkParams {
      ethAddress = Address 0xeae0695468d78aa496259834855ed566e75bffcb,
      webAddress = "3.226.74.116"
      }
  ]
getParams "blockappsnet" = return $ Just
  [
    NetworkParams {
      -- pubkey 04bddb5191e26688310253d075fe2b673ec2cdb81c64cc86383e194710d601b45465c746e31300d28e096d4ad045fd50a915b302b3e5d53cb77655d192e36bd2c2
      ethAddress = Address 0xa17487ff88e58c916a9c4ada54a32f10c7081075,
      webAddress = "54.243.143.176"
--      webAddress = "engineering.stratoid.blockapps.net"
      }
  ]
getParams _ = return Nothing
