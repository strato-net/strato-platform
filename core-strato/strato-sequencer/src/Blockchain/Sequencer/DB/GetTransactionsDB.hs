{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators    #-}

module Blockchain.Sequencer.DB.GetTransactionsDB where

import           Blockchain.SHA
import           Control.Monad.Change.Modify
import qualified Data.Set                     as S

type HasGetTransactionsDB = Modifiable (S.Set SHA)

insertGetTransactionsDB :: HasGetTransactionsDB m => SHA -> m ()
insertGetTransactionsDB txHash = modify_ Proxy $ pure . S.insert txHash

clearGetTransactionsDB :: HasGetTransactionsDB m => m ()
clearGetTransactionsDB = put (Proxy @(S.Set SHA)) S.empty
