{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DerivingStrategies         #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE StandaloneDeriving         #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE TypeOperators              #-}
{-# LANGUAGE UndecidableInstances       #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-orphans #-}

--This module has to be separated out because Template Haskell makes it hard to export the individual items created
module Blockchain.Strato.Discovery.Data.PeerDefinition where

import           Blockchain.Data.PersistTypes      ()
import           Blockchain.MiscJSON               ()
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256
import           Crypto.Types.PubKey.ECC
import           Data.IP
import qualified Data.Text                         as T
import           Data.Time
import qualified Database.Persist.Postgresql       as SQL
import           Database.Persist.TH

derivePersistField "IP"

share
  [mkPersist sqlSettings, mkMigrate "migrateAll"]
  [persistLowerCase|
PPeer
    pubkey Point Maybe
    host Host
    ip IP Maybe
    tcpPort Int
    udpPort Int
    numSessions Int
    lastMsg T.Text
    lastMsgTime UTCTime
    enableTime UTCTime
    udpEnableTime UTCTime
    lastTotalDifficulty Integer
    lastBestBlockHash Keccak256
    bondState Int
    activeState Int
    version T.Text
    disableException T.Text
    nextDisableWindowSeconds Int default=5
    nextUdpDisableWindowSeconds Int default=5
    disableExpiration UTCTime default=CURRENT_TIMESTAMP
    deriving Show Read Eq
|]
