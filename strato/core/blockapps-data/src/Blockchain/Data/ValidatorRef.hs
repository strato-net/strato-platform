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


-- Provide (False, [Addresses]) to remove from database
-- Provide (True,  [Addresses]) to add    to   database
addRemoveValidator :: HasSQLDB m =>
                            ([Address], [Address]) -> m ()-- m (Key ValidatorRef)
addRemoveValidator (remove, add) = do
    --txrs   <-  fmap (map E.entityVal) $  sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
    --let setDifference = addr L.\\ ( (\(ValidatorRef x) -> x ) <$> txrs)
  when (add /= [])
      (forM_ add $ (\x -> sqlQuery $  E.insert ValidatorRef{ validatorRefAddress = x })) >> pure ()
        
--addRemoveValidator (False, addr) = 
  if remove /= [] then (forM remove  $ (\x -> sqlQuery $ E.delete $ E.from $ \address -> E.where_ (address E.^. ValidatorRefAddress E.==. (E.val $ x :: E.SqlExpr (E.Value Address))))) >> pure ()                                                                       
     else pure ()