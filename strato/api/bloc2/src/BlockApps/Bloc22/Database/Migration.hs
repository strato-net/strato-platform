{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module BlockApps.Bloc22.Database.Migration
  ( runBlocMigrations
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Text                                    as T
import           Database.PostgreSQL.Simple

import           BlockApps.Bloc22.Database.Create
import           BlockApps.Bloc22.Monad
import           BlockApps.Logging
import           Control.Monad.Composable.BlocSQL

runBlocMigrations :: (MonadIO m, MonadLogger m, HasBlocSQL m) => m ()
runBlocMigrations = do
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Create tables"
  void . blocModify $ \conn -> execute_ conn createTables