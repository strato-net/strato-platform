module Blockchain.Strato.Model.BlockchainClass where

import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Query

class Monad m => Blockchain m where
  getBlocks :: BlockLike h t b => BlockQuery -> m [b]
  getHeaders :: BlockHeaderLike h => HeaderQuery -> m [h]
  putBlocks :: (Traversable f, BlockLike h t b) => f b -> m (f (Either l r))
  putHeaders :: (Traversable f, BlockHeaderLike h) => f h -> m (f (Either l r))
