# How to deploy a strato node or network using these scripts

Increasingly, the two are becoming the same.  Ideally the whole process would be
automatic, but as it is, you have to specify just a little bit of startup data
to bootstrap things.

## Single node

You need a machine with port 443 open and available.  To run strato from our
docker images tagged `<tag>`, first `stratoVersion=<tag>`.  Then simply
`./init-strato.sh`.  You can get a custom genesis block by placing it in a file
`<filename>` and (before `init-strato.sh`) setting `genesisFile=<filename>` and
`genesis=<some name>`.

## Multi-node

You can add networked nodes to a single node deployment with a small environment
variable setting.  First you need an additional machine with ports 443 and 30303
(tcp/udp) open and available, and in addition to the above instructions, you
should first `bootnode=<ip address>`, where `<ip address>` is the location of
the original single-node deployment.  This only works for a branch descended
from `strato-bootnodes`, for which the tag is `bootnodes`.  Note that all
machines must have the same genesis block.  If you really want, you can set the
network ID for your network by appending it as an argument to `init-strato.sh`,
i.e. `./init-strato.sh 6`.

## Livenet

This is not well-tested in the field, but to get a single node connected to the
public network, first set `addBootnodes=true` and `genesis=livenet`.
