
## Using generate-genesis
`generate-genesis` can be used to include contract accounts in the first
unmined block of your chain. That inclusion can have significant performance
gains, but has some pitfalls. The first is that the contract cannot initialize
any storage until a method call has been made: the constructor must be essentially
empty and the fields of the contract cannot have an initial value.

The second is that both the bin-runtime (encoded in base16) and the source must
be provided as flags to `generate-genesis`.  To retrieve the bin-runtime,
running `solc --bin-runtime <file>.sol` will generate it.  The caveat here is
that contracts uploaded through bloch will have additional functions inserted
into it (e.g. `__getSource__`), which means that they will have different
binaries corresponding codehashes. To get a modified version of the contract
source, you might want to look at the [bloc tests](
https://github.com/blockapps/blockapps-haskell/blob/master/bloc/bloc22/server/test/Database/Spec.hs),
where a function called `writeAugment` can generate the source that bloc would
generate.

# Timing
| Size | Generation Time | Upload Time |
| 1000 | 0.062s | ?? |
| 10000 | 0.294s | 103.39s |
| 100000 | 2.675s | 812.18s |
| 1000000 | 27.706s | 16500.33s |
| 10000000 | 344.37s | ?? |
| 100000000 | 4116.15s | ?? |

