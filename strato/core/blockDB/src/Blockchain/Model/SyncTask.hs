{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.Model.SyncTask (
  SyncTask(..),
  SyncTaskStatus(..),
  EntityField(..),
  migrateAll
  ) where

import Data.Text (Text)
import Data.Time
import Database.Persist.Sql
import Database.Persist.TH
import Text.Format
import Text.Format.Template

data SyncTaskStatus = Assigned | Finished | NotReady deriving (Show, Read, Eq)

derivePersistField "SyncTaskStatus"
$(deriveFormat ''SyncTaskStatus)

-- Chiliad: It's a real word, go look it up
share
  [mkPersist sqlSettings, mkMigrate "migrateAll"]
  [persistLowerCase|
SyncTask
    chiliad Int default=nextval('chiliad')
    assignmentTime UTCTime default=now()
    host Text
    status SyncTaskStatus default='Assigned'
    deriving Show Read Eq
|]
        
$(deriveFormat ''SyncTask)

