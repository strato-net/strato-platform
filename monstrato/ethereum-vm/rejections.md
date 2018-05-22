## Transaction rejection policy

Sending a transaction `T` to the API results in the following:

+ `T` is put into `/transaction` with `T.blocknumber = -1`
 + If `T.nonce <= nonce(T.from)` the transaction is rejected. The rejection result can be queried at `/transactionResult/<T.hash>`
 + If `T.nonce = nonce(T.from)+1`, `T` is put in a block `n` and run by the VM. `T.blocknumber` is now `n`.
 + If `nonce(T.from) + 1 < T.nonce < `nonce(T.from) + L` where `L` is the window parameter of `strato-sequencer`, it will be kept in the queue and processed once `nonce(T.from)` reaches `T.nonce`. Currently we're not updating the `/transactionResult` for these transactions.
 + If `T'` and `T` enter the queue with `T.nonce = T'.nonce` then the transaction with the lowest `gasLimit*gasPrice` will be dropped. 
