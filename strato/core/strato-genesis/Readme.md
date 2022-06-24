
## Using generate-genesis
`generate-genesis` can be used to include contract accounts in the first
unmined block of your chain. That inclusion can have significant performance
gains, but has some pitfalls.

The most major is that both the bin-runtime (encoded in base16) and the source must
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

Note also that if storage is to be initialized, the contract source
will lie about it. When using storage initialization in the genesis
block, any initialization or constructors written in solidity will
be ignored. It is recommended to initialize no data in solidity
source to prevent mistaken conclusions about a line like `uint x = 17;`.

To initialize contracts without storage provide an original genesis file,
bytecode, source, a start address, and a count:

    generate-genesis --genesis_file=gettingStartedGenesis.json \
                     --bytecode_file=Element.bin-runtime \
                     --source_file=Element.sol \
                     --start=1024
                     --count=118

The above command will create 118 Element contracts, at addresses 0x400 through
0x475.

To initialize contracts with storage, you must first generate an records
json file. The records file is an array of arrays, where each inner
array corresponds to one contract initialization. The elements of
the inner arrays can be strings, numbers, structs, and dynamically
sized arrays and their order should
reflect the order the intended contract fields are declared in. If there
are more contract fields than array entries, the fields will stay initialized
to the zero element of that type.

Note also a somewhat peculiar format for structs: they are JSON objects, with
keys denoting the order of the elements of the structs. Keys can be chosen
arbitrarily, as long as sorting them reflects the proper order of the struct
definition.

Failure to order columns correctly will result in silently corrupted data.
For example, consider the following contract:

    contract Element {
       string name;
       string symbol;
       uint atomicNumber;
       struct position {
        uint x;
        uint y;
       }
       position[] ensemble;
       ...
    }

A working records file would look like

    [
      ["Lithium", "Li", 3, [{"0": 99, "1": 307}, {"0": 40, "1": 40}]],
      ["Iridium", "Ir", 77]
    ]

But a malfunctioning one would look like

    [
      ["Cesium", 55, "Cs"]
    ]
because it would imply an element with
0x4373000000000000000000000000000000000000000000000000000000000004 protons.

Sample usage of the tool looks like:

    generate-genesis --genesis_file=gettingStartedGenesis.json \
                     --bytecode_file=Element.bin-runtime \
                     --source_file=Element.sol \
                     --records_file=elements.json \
                     --output_file=elementGenesis.json \
                     --start=150000000


# Timing
| Size | Generation Time | Upload Time |
| ---: | ---: | ---:
| 1000 | 0.062s | ?? |
| 10000 | 0.294s | 103.39s |
| 100000 | 2.675s | 812.18s |
| 1000000 | 27.706s | 16500.33s |
| 10000000 | 344.37s | ?? |
| 100000000 | 4116.15s | ?? |

