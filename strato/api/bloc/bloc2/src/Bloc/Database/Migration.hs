{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Bloc.Database.Migration
  ( runBlocMigrations
  ) where

import           Control.Monad
import qualified Data.Text                                    as T
import           Database.PostgreSQL.Simple

import           Bloc.Database.Create
import           Bloc.Monad
import           BlockApps.Logging
import           Control.Monad.Composable.BlocSQL

runBlocMigrations :: (MonadLogger m, HasBlocSQL m) => m ()
runBlocMigrations = do
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Create tables"
  void . blocModify $ \conn -> execute_ conn createTables