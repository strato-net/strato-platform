
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
      -- pubkey 049e1d9b9e91d60025739dedf9996a36f11e9a2b612a0d065827e8986acfd7265d2e19b7b6b2eca182b94a3caed7c41ac9c5335d98caf52282e4ecd0dec3315e92
      ethAddress = Address 0x4df0c501943fc2aea1ed1de61f1d719b1845fac7,
      webAddress = "54.243.143.176"
--      webAddress = "engineering.stratoid.blockapps.net"
      }
  ]
getParams _ = return Nothing
