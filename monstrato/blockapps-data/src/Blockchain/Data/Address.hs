{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.Data.Address (
  Address(..),
  prvKey2Address,
  pubKey2Address,
  getNewAddress_unsafe,
  addressAsNibbleString,
  addressFromNibbleString,
  formatAddressWithoutColor
  ) where

import           Data.Binary
import qualified Data.ByteString.Lazy            as BL
import qualified Data.NibbleString               as N
import           Numeric

import           Blockchain.Data.RLP
import           Blockchain.SHA
import           Blockchain.Util

import           Blockchain.Strato.Model.Address


getNewAddress_unsafe ::Address->Integer->Address
getNewAddress_unsafe a n =
    let theHash = hash $ rlpSerialize $ RLPArray [rlpEncode a, rlpEncode n]
    in decode $ BL.drop 12 $ encode theHash


addressAsNibbleString::Address->N.NibbleString
addressAsNibbleString (Address s) =
  byteString2NibbleString $ BL.toStrict $ encode s

addressFromNibbleString::N.NibbleString->Address
addressFromNibbleString = Address . decode . BL.fromStrict . nibbleString2ByteString

formatAddressWithoutColor::Address->String
formatAddressWithoutColor = formatAddress
