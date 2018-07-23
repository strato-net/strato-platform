
module Blockchain.Sequencer.DB.Witnessable where

import           Blockchain.SHA

class Witnessable t where
    witnessableHash :: t -> SHA

