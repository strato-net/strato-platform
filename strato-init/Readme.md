
## Using generate-genesis
`generate-genesis` can be used to include contract accounts in the first
unmined block of your chain. That inclusion can have significant performance
gains, but has some pitfalls. The first is that the contract cannot initialize
any storage until a method call has been made: the constructor must be essentially
empty and the fields of the contract cannot have an initial value.

The second is that both the bin-runtime (encoded in base16) and the source must
be provided as flags to `generate-genesis`. The most reliable way to generate the
correct source and bin-runtime pair is to post the source to bloch's
/users/{user}/{address}/contract?resolve=true endpoint. `solc --runtime-bin` is not
sufficient, because bloch inserts self describing functions into the contract
like `__getSource__`. Someone clever might think that it's enough to just use
a contract that already has an accurate `__getSource__` and compile that with
solc, but then when bloch compiles that contract it will insert a new
`__getSource__` that has the old `__getSource__`, changing the code (and
necessarily the codehash) again. Once the codehashes mismatch between
what bloch computes it to be and what strato is initialized with, all queries
will fail.

# Timing
| Size | Generation Time | Upload Time |
| 1000 | 0.062s | ?? |
| 10000 | 0.294s | 103.39s |
| 100000 | 2.675s | 812.18s |
| 1000000 | 27.706s | 16500.33s |
| 10000000 | 344.37s | ?? |
| 100000000 | 4116.15s | ?? |

