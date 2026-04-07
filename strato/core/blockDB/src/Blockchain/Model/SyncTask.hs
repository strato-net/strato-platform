{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DerivingStrategies         #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE StandaloneDeriving         #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE TypeOperators              #-}
{-# LANGUAGE UndecidableInstances       #-}

module Blockchain.Model.SyncTask (
  SyncTask(..),
  SyncTaskStatus(..),
  EntityField(..),
  migrateAll
  ) where

import           Blockchain.Strato.Model.Host
import           Data.Time
import           Database.Persist.Sql
import           Database.Persist.TH
import           Text.Format
import           Text.Format.Template
import           Text.ShortDescription

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
    host Host
    status SyncTaskStatus default='Assigned'
    deriving Show Read Eq
|]

$(deriveFormat ''SyncTask)

instance ShortDescription SyncTask where
  shortDescription SyncTask{..} = "SyncTask: chiliad #" ++ show syncTaskChiliad ++ " (" ++
    case syncTaskStatus of
      Assigned -> "assigned to " ++ show syncTaskHost ++ " at " ++ show syncTaskAssignmentTime
      Finished -> "FINISHED"
      NotReady -> "Not Ready"
    ++ ")"

