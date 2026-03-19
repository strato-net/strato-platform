{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Network where

import Blockchain.Strato.Model.Address

data PeerParams = NetworkParams
  { ethAddress :: Address,
    webAddress :: String
  }

getParams :: String -> IO (Maybe [PeerParams])
getParams "oldblockappsnet" =
  return $
    Just
      [ NetworkParams
          { ethAddress = Address 0xeae0695468d78aa496259834855ed566e75bffcb,
            webAddress = "3.226.74.116"
          }
      ]
getParams "blockappsnet" =
  return $
    Just
      [ NetworkParams
          { -- pubkey 04bddb5191e26688310253d075fe2b673ec2cdb81c64cc86383e194710d601b45465c746e31300d28e096d4ad045fd50a915b302b3e5d53cb77655d192e36bd2c2
            ethAddress = Address 0xa17487ff88e58c916a9c4ada54a32f10c7081075,
            webAddress = "54.243.143.176"
            --      webAddress = "engineering.stratoid.blockapps.net"
          }
      ]
getParams "mercata-testnet" =
  return $
    Just
      [ NetworkParams
          { -- pubkey 04bddb5191e26688310253d075fe2b673ec2cdb81c64cc86383e194710d601b45465c746e31300d28e096d4ad045fd50a915b302b3e5d53cb77655d192e36bd2c2
            ethAddress = Address 0x44f1b8c88be13021806e1c3a7a2d5204a1bda57,
            webAddress = "44.209.100.194"
            --      webAddress = "engineering.stratoid.blockapps.net"
          }
      ]
getParams "mercata-hydrogen" =
  return $
    Just -- to make network id: mercata-hydrogen -> ascii to hex -> convert # to base10
      [ NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "52.4.166.179" -- testnet2 node 1
          }
      ]
getParams "helium" =
  return $
    Just -- to make network id: mercata-hydrogen -> ascii to hex -> convert # to base10
      [ NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "44.198.225.165"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "34.197.19.103"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "44.206.83.54"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "34.194.64.79"
          }
      ]

getParams "upquark" =
  return $
    Just -- to make network id: mercata-hydrogen -> ascii to hex -> convert # to base10
      [ NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "13.219.185.85"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "3.208.147.58"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "44.221.199.15"
          },
        NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "54.83.139.46"
          }
      ]

getParams "lithium" =
  return Nothing -- local development network, no external peers






getParams "mercata" =
  return $
    Just -- to make network id: mercata-hydrogen -> ascii to hex -> convert # to base10
      [ NetworkParams
          { ethAddress = Address 0x100, -- not important
            webAddress = "44.209.149.47" -- prod node 1
          }
      ]
getParams _ = return Nothing
