{-#   LANGUAGE FlexibleContexts     #-}
{-#   LANGUAGE OverloadedStrings    #-}
{-#   LANGUAGE RecordWildCards      #-}
{-#   LANGUAGE TypeApplications     #-}
{-#   LANGUAGE TypeOperators        #-}
{-#   LANGUAGE ScopedTypeVariables  #-}

module Blockchain.Data.ValidatorRef where

import           Control.Monad                     (when, forM, forM_)

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Address
import qualified Database.Esqueleto.Legacy          as E


addRemoveValidator :: HasSQLDB m =>
                            ([Address], [Address]) -> m ()
addRemoveValidator (remove, add) = do
  when (add /= []) (forM_ add $ (\x -> sqlQuery $  E.insert ValidatorRef{ validatorRefAddress = x })) 
  if remove /= [] 
    then (forM remove  $ (\x -> sqlQuery $ E.delete $ E.from $ \address -> E.where_ (address E.^. ValidatorRefAddress E.==. (E.val $ x :: E.SqlExpr (E.Value Address))))) >> pure ()                                                                       
    else pure ()        
