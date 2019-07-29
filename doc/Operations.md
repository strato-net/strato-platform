# Operational Tips and Tricks

This is a grab bag of scripts and techniques that I've used to get work done.
Some are BlockApps specific and some are more generic, some are used
at compilation and others are used on running services.

### How do I prevent the UI from hanging while compiling?
```
tim@ip-172-31-11-233 ~/bin ❯❯❯ which stack
stack: aliased to nice stack
```
However, I don't think this is always enough. Part of the reason that working
on a remote server works well is that all the cores can be dedicated to compilation
and my laptop is mostly idle.

### How do I compile efficiently?
Using an inotify wait, you can start stack as soon as files are saved:
```
#!/usr/bin/env sh
nice $@
while true
do
  inotifywait -qq -r -e create,close_write,modify,move,delete ./ && nice $@
done

```

### How do I find the binaries that stack built?
If you can run it from the `strato-platform` tree, you can do `stack exec queryStrato -- --help`.
When you need to move the binary somewhere else, you can find its absolute path with
`stack exec which queryStrato`.

### How do I build an image faster?
There are a few slow aspects to building an image. The two main ones seem to be compilation and
sending context to the docker daemon. If you only want to update a single binary to test changes,
you can get a more rapid feedback loop by compiling that binary directly, and using a custom
Dockerfile to modify an existing image. For the example of `vm-runner`, the build step is
just `stack install vm-runner`. Its not sufficient to re-use the build context directory
used for the strato image, because the lingering binaries there will still be sent to the daemon,
and as that is ~1GB of context it takes precious seconds to send. I typically create a new
context directory in tmp, and then the Dockerfile can just be
```
FROM registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0
COPY ./vm-runner /usr/local/bin
```
Putting this all together in one script, that looks like
```
#!/usr/bin/env bash

if [ $# -lt 2 ]
then
  echo "usage: reflash_exe <base_image> <exe> [<target>]"
  exit 2
fi

set -x
set -e

BASE_IMAGE=$1
EXE=$2
TARGET=${3:-${EXE}}
IMAGE_TAG="flash_${EXE}"
BUILD_DIR="/tmp/flash/${EXE}/"
echo $BASE_IMAGE $EXE $TARGET
mkdir -p ${BUILD_DIR}
stack install ${TARGET}
cat << EOF >| ${BUILD_DIR}/Dockerfile
FROM ${BASE_IMAGE}
COPY ./${EXE} /usr/local/bin/
EOF
cp -f $(stack exec which ${EXE}) ${BUILD_DIR}
docker build -t ${IMAGE_TAG} ${BUILD_DIR}
echo "Image ${IMAGE_TAG} created"
```

Compilation of the binary will likely still be a bottleneck,
but if it only has to compile the package or two that you are working
in the savings can be worth it over a full rebuild. With a full cache,
this takes 4s to create a new image:
```
tim@ip-172-31-11-233 ~/strato-platform ❯❯❯ /usr/bin/time reflash_exe registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0 vm-runner
+ set -e
+ BASE_IMAGE=registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0
+ EXE=vm-runner
+ TARGET=vm-runner
+ IMAGE_TAG=flash_vm-runner
+ BUILD_DIR=/tmp/flash/vm-runner/
+ echo registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0 vm-runner vm-runner
registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0 vm-runner vm-runner
+ mkdir -p /tmp/flash/vm-runner/
+ stack install vm-runner
Copying from /home/tim/strato-platform/.stack-work/install/x86_64-linux-dkf7b33dd99b569c2d0a323e8a6dc29e94/4f767e13b819d23b7564fab45cf775af23a518297fe19af611d7ef927b3d9ab6/8.4.3/bin/vm-runner to /home/tim/strato-platform/.stack-work/docker/_home/.local/bin/vm-runner

Copied executables to /home/tim/strato-platform/.stack-work/docker/_home/.local/bin:
- vm-runner
+ cat
++ stack exec which vm-runner
+ cp -f /home/tim/strato-platform/.stack-work/install/x86_64-linux-dkf7b33dd99b569c2d0a323e8a6dc29e94/4f767e13b819d23b7564fab45cf775af23a518297fe19af611d7ef927b3d9ab6/8.4.3/bin/vm-runner /tmp/flash/vm-runner/
+ docker build -t flash_vm-runner /tmp/flash/vm-runner/
[+] Building 0.4s (8/8) FINISHED
 => [internal] load build definition from Dockerfile                                                                       0.0s
 => => transferring dockerfile: 135B                                                                                       0.0s
 => [internal] load .dockerignore                                                                                          0.0s
 => => transferring context: 2B                                                                                            0.0s
 => [internal] load metadata for registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0                               0.0s
 => [internal] helper image for file operations                                                                            0.0s
 => [1/2] FROM registry-aws.blockapps.net:5000/blockapps-repo/strato:4.5.0                                                 0.0s
 => [internal] load build context                                                                                          0.3s
 => => transferring context: 54.23MB                                                                                       0.3s
 => CACHED [2/2] COPY ./vm-runner /usr/local/bin/                                                                          0.0s
 => exporting to image                                                                                                     0.0s
 => => exporting layers                                                                                                    0.0s
 => => writing image sha256:df7f997dfdb7f72e68fa2edd38b693174753be81004f1a53a2ade16cd92bdd3f                               0.0s
 => => naming to docker.io/library/flash_vm-runner                                                                         0.0s
+ echo 'Image flash_vm-runner created'
Image flash_vm-runner created
0.47user 0.41system 0:04.26elapsed 20%CPU (0avgtext+0avgdata 57004maxresident)k
0inputs+106296outputs (0major+70036minor)pagefaults 0swaps
```
If the process is restart-safe, you can probably test even faster by not bothering to make an image,
copying the binary directly into the container, and restarting the process (see below).

### What's the easiest way to create a transaction?
```
curl -u admin:admin -F address=cad7234 localhost/strato-api/eth/v1.2/faucet
```

### How do I restart a process?
From 4.5.0 on, every process created with a haskell binary has a signal
handler installed that will catch a SIGHUP and exec itself. What this affords
is is the ability to reset memory on a process or swap out the executable,
while retaining the supervision from doit.sh. The trick here is that
historically, process creation has consisted of two parts: `fork` uses the same
process image but creates a new copy, and `exec` changes the process image in
place. We don't fork here, so the process is just replaced.  The same `argv` is
used and so flags are not changed, and the environment is inherited from the
original process.

There are some caveats to this trick. If used on a process that doesn't support
this, the default handler for SIGHUP is termination. Then doit.sh will
terminate all processes. In 4.5.0, all executables should install the handler
(through calling `blockappsInit`), but its probably worth checking before
trying this in production and `blockappsInit` should be called at the start of
`main` for all new long lived processes.

The other caveat is that files opened by the original process should have
CLOEXEC (close-on-exec).  Libraries like `leveldb` and `wai` should be doing
this already (or something else to simulate the behavior), but there was a bug
in implementing this where the file descriptor used to listen on port 30303
stayed open in `strato-p2p`, and it was not able to reaquire it for listening.

The process should also be designed to be able to restart itself normally, by
either being stateless (like strato-p2p) or saving the necessary state
somewhere persistent (like strato-sequencer with the kafka metadata).

### How do I pause a node?
I've never tried `docker pause strato_strato_1`, but it should halt all
processes and be able to resume them with `docker unpause strato_strato_1`. If
you just want to stop a branch of inputs/outputs to prevent the node from doing
damage or isolate it for debugging, a SIGSTOP will pause the process that can
be resumed with SIGCONT: ```docker exec strato_strato_1 pkill --exact --echo
strato-p2p\|strato-api``` (Note that /proc/<pid/>stat has an upper bound of 15
characters for the process name, so pkill has a bizarre upper bound of 15
characters in the process name, and needs either --full or a truncated process
name to target correctly:
```
tim@ip-172-31-11-233 ~/strato-platform ❯❯❯ docker exec strato_strato_1 pkill --echo strato-sequencer
tim@ip-172-31-11-233 ~/strato-platform ❯❯❯ docker exec strato_strato_1 pkill --echo strato-sequenc    ✘ 1
strato-sequence killed (pid 60)
```

### How do I modify a checkpoint?
In the easy case, queryStrato has a switch for this:
```
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ qs checkpoints --service apiindexer --op=get
Checkpoint for service: apiindexer
Offset is Offset 1
Metadata is:
1


tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ qs checkpoints --service apiindexer --op=put --metadata=13
Existing data for service: apiindexer
Offset is Offset 1
Metadata is:
1

Will commit the following checkpoint for service: apiindexer
Offset is Offset 1
Metadata is:
13


Verify commit for service: apiindexer
Offset is Offset 1
Metadata is:
13

Offset is Offset 1
Metadata is:
13
```
If the checkpoint is RLP encoded, then you are kind of on your own in trying to craft a new one regardless of
whether queryStrato knows about the service.

In the hard case `queryStrato` is less helpful. Checkpoints should no longer be expiring, but if you think
they are you can examine the topics of checkpoints to see the full history:
```
host> docker exec -it strato_kafka_1 bash
kafka> cd /opt/kafka/bin
kafka> echo "exclude.internal.topics=false" > /tmp/consumer.config
kafka> ./kafka-console-consumer.sh --consumer.config /tmp/consumer.config --zookeeper zookeeper:2181 --topic __consumer_offsets --from-beginning --formatter "kafka.coordinator.group.GroupMetadataManager\$OffsetsMessageFormatter"
<snip>
[ethereum-vm_3f968dc6f353bc2ece73bd595d9000704d6e9b18,seq_vm_events,0]::[OffsetMetadata[93,f9046fa0dda9d456dd2939ae5485e16fd73524909e1a5e1118ef3c1810c4da54190797daf901fda00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a043c4ee6bfd58c0f5d1684b34985731f6246ab0324ea6a3c1ec3cf92951004ab0a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000822000808e011c37937e080000000000000000808000a0000000000000000000000000000000000000000000000000000000000000000088000000000000002af9022a01f90226a0dda9d456dd2939ae5485e16fd73524909e1a5e1118ef3c1810c4da54190797daf901fda00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a043c4ee6bfd58c0f5d1684b34985731f6246ab0324ea6a3c1ec3cf92951004ab0a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000822000808e011c37937e080000000000000000808000a0000000000000000000000000000000000000000000000000000000000000000088000000000000002a8220008080a022a010157cf320580d1614a425f1cdf5b6125727e2dd1e9dc6bf918cbd75c155],CommitTime 1564413406433,ExpirationTime 130413432226433]
[strato-txr-indexer_3f968dc6f353bc2ece73bd595d9000704d6e9b18,indexevents,0]::[OffsetMetadata[0,NO_METADATA],CommitTime 1564412490876,ExpirationTime 130413431310876]
[strato-txr-indexer_3f968dc6f353bc2ece73bd595d9000704d6e9b18,indexevents,0]::[OffsetMetadata[1,NO_METADATA],CommitTime 1564412490927,ExpirationTime 130413431310927]
[strato-sequencer_3f968dc6f353bc2ece73bd595d9000704d6e9b18,unseqevents,0]::[OffsetMetadata[0,{"checkpointValidators":[],"checkpointVoteRecord":{},"checkpointView":{"round":"0000000000000000000000000000000000000000000000000000000000000000","sequence":"0000000000000000000000000000000000000000000000000000000000000000"},"checkpointAdmins":[]}],CommitTime 1564412490877,ExpirationTime 130413431310877]
<snip>
```

If you do figure out what changes need to be made, the python kafka library would probably be the easiest way to manipulate it:
```
host> docker exec -it strato_strato_1 bash
strato> apt update && apt install python python-kafka
strato> python
Python 2.7.15+ (default, Nov 27 2018, 23:36:35)
[GCC 7.3.0] on linux2
Type "help", "copyright", "credits" or "license" for more information.
>>> import kafka
>>> con = kafka.KafkaConsumer('indexevents', group_id='strato-api-indexer-test', bootstrap_servers='kafka :9092')
>>> con.commit({kafka.TopicPartition('indexevents', 0): kafka.OffsetAndMetadata(20, '4557')})
```

### How do I run jenkins from the terminal?
The token is part of the STRATO_test configuration, and this may no longer be the right one
```
#!/usr/bin/env zsh
set -x
set -e

BRANCH=$(git branch | grep -e "^*" | cut -d ' ' -f 2)
git push origin ${BRANCH}
TOKEN="rdaABqoRvQLjQga"
URL="https://jenkins.blockapps.net/buildByToken/buildWithParameters?job=STRATO_test&token=${TOKEN}&PLATFORM_BRANCH_NAME=${BRANCH}"
echo curl -X POST -L --insecure $URL
curl -X POST -L --insecure $UR
```

### How do I grab a docker-compose.yml from a test run?
In the following, I'm assuming that `jenkins` is in your `.ssh/config` as the host
that our jenkins master runs on. The path of `SOURCE_DIR` is liable to change. It would
have been nicer to just grab the artifact over HTTP, but it was too difficult for me to
figure out how to authenticate curl.
```
#!/usr/bin/env zsh

if [  $# -lt 1 ]
then
  echo "usage: grab_dc.sh <build_number>"
  exit 1
fi
set -x
set -e

BUILD_NUMBER=$1
SOURCE_DIR="/var/jenkins_home/jobs/STRATO_test/builds/${BUILD_NUMBER}/archive/strato-worktree/docker-compose.yml"
TMP_DIR="/tmp/dcs/${BUILD_NUMBER}/"
mkdir -p ${TMP_DIR}
ssh jenkins mkdir -p "${TMP_DIR}"
ssh jenkins sudo docker cp "jenkins_jenkins_1:${SOURCE_DIR}" "${TMP_DIR}"
scp jenkins:"${TMP_DIR}/docker-compose.yml" "${TMP_DIR}"
cp "${TMP_DIR}/docker-compose.yml" .
```

### How do I search for a regression?
If you have a range of commits and really no idea why a problem is happening, if you can
automate the test case then `git bisect` can be an effective way to search the commit log.
For a more detailed overview, `git help bisect` can be good but the relevant aspects here
are that you can provide a good commit, a bad commit, and a script that can distinguish the
two and `git bisect` will run through until it finds the smallest gap between good and bad.
If the exit code of the script is 125, then bisect will mark this commit as unknown and move
to a neighbor, which is useful if this commit is not able to compile. As an example to
search for a failing ht3 test in the specific case of the strato-platform,
consider the following script:
```
#!/usr/bin/env zsh
set -x
set -e

export VERSION=bisect
export REPO=local

make bloc strato vault-wrapper || (stack clean && make bloc strato vault-wrapper) || exit 125
export STRATO_IMAGE=strato:bisect
export BLOC_IMAGE=bloc:bisect
export VAULTWRAPPER_IMAGE=vault-wrapper:bisect
reload_ht3
run_ht3
```
In this case `reload_ht3` will `cd strato-getting-started && ./strato --wipe && ./strato```
and `run_ht3` will `cd ht3 && npm run test`. The VERSION and REPO environment variables will
set the tags on the created strato/bloc/vault-wrapper images, and then `{STRATO,BLOC,VAULTWRAPPER}_IMAGE`
will use those images to start the new containers. If image construction fails, then we try
one more time (as sometimes a stack clean helps to clear out versions of object files that can't coexist),
but if that fails too we mark the commit as uncertain and move to the next.
To kick off the search,
```
git bisect start
git bisect bad develop
git bisect good 4.2.0
git bisect run ht3-bisect.sh
```
and go about your business doing other things, as even though this should only test ~20 commits it will take
a long time on each one. For a simpler example looking for the removal of a variable (the cabal files were
giving checkout issues):
```
tim@ip-172-31-11-233 ~/s/ironhide ❯❯❯ find . -name "*cabal" -exec rm {} \;
tim@ip-172-31-11-233 ~/s/ironhide ❯❯❯ git bisect start
tim@ip-172-31-11-233 ~/s/ironhide ❯❯❯ git bisect bad develop
tim@ip-172-31-11-233 ~/s/ironhide ❯❯❯ git bisect good c39e09
Bisecting: 2647 revisions left to test after this (roughly 11 steps)
[3216b8828806275ba2b6d177a5471208adc03601] Merge pull request #540 from blockapps/partial_unlift_3
tim@ip-172-31-11-233 ~/s/ironhide ❯❯❯ git bisect run grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 1290 revisions left to test after this (roughly 10 steps)
[7b62d4dd62086e567895371ce6726c651d05ffd6] Fixed merge conflicts
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 643 revisions left to test after this (roughly 9 steps)
[b1dc4e983a8b0aa5abed67741a57f93937ec2f44] Merge pull request #396 from blockapps/fmt
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 321 revisions left to test after this (roughly 8 steps)
[e7b6d3f944fbc2576a7f94e4661cc1b027bb1b90] add back txsParameters
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 146 revisions left to test after this (roughly 7 steps)
[8542fbc34f64fa9998a7876c063e0620492f9104] Merge branch 'develop' into audit-trail
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 87 revisions left to test after this (roughly 7 steps)
[d4f9611bf88d4e267478e817a783a224b94bddea] Merge pull request #372 from blockapps/independence
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 41 revisions left to test after this (roughly 6 steps)
[467be02de9c696617a28ab4e4b2bef50060d161d] Merge branch 'audit-sloppy' into Slipstream-history
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 26 revisions left to test after this (roughly 5 steps)
[1782b44b9d5bdbae852614d40574e7e539aa2aa9] Resolved Newest Develop
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 13 revisions left to test after this (roughly 4 steps)
[48cd95fb79b087591596cde1b24c0cc0f189cdb6] Modified Test To Include View Creation and Name Resolution
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 6 revisions left to test after this (roughly 3 steps)
[d343b9d1ba9d8bb54615e62276c36b34027a9f30] Updated PSQL Output
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
Bisecting: 3 revisions left to test after this (roughly 2 steps)
[3253b5a94782a4e75061c6eb7d577ac385acf13b] Added Action.hs
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 0 revisions left to test after this (roughly 1 step)
[49a9e02fcaa991cb6eb887f672c5dbfe21243907] Always run blocks
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
Bisecting: 0 revisions left to test after this (roughly 0 steps)
[ad4745c6c8269b7900cea742ba5f4014dc311afc] Add tx level cache to in-memory dbs
running grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
            let currentBaggerSR = Bagger.lastRewardedStateRoot cache
            $logInfoS "addBlocks" . T.pack $ "Bagger state root: " ++ format currentBaggerSR
            if (flags_miner /= Mining.Instant || blockSR == currentBaggerSR)
49a9e02fcaa991cb6eb887f672c5dbfe21243907 is the first bad commit
commit 49a9e02fcaa991cb6eb887f672c5dbfe21243907
Author: dustinnorwood <dnorwood2010@aol.com>
Date:   Tue Sep 18 12:00:15 2018 -0400

    Always run blocks

:040000 040000 981b84cfe5061e61c2e63b55784eea052cc291ba 4452357a981ce9de12c81e84889bf48d1d0a0135 M      core-strato
bisect run success
```
In this case 49a9 is not actually a "bad" commit, just the first one that the test failed on.

### How do I kill a single p2p thread?
Maybe you have a bug in p2p, and a thread is hung or filtering certain messages. Or it is leaking memory,
and you want to kill threads to reclaim that memory but can't do a full process restart. In this
case what you can do is attach to the process and close the file descriptior for a socket to a peer, so
that the next write causes the thread to throw an exception and be replaced by a new one.

The first step is seeing which file descriptor is allocated for a particular peer:
```
host> docker exec -it strato_strato_1 bash
strato> apt update && apt install lsof
strato> lsof -p $(pgrep --exact strato-p2p)
root@f30c58887d4b:/var/lib/strato# lsof -p $(pgrep --exact strato-p2p) | grep IPv4
strato-p2  75 root   11u     IPv4 299133014      0t0       TCP f30c58887d4b:37122->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   12u     IPv4 190271661      0t0       TCP *:10248 (LISTEN)
strato-p2  75 root   13u     IPv4 299132395      0t0       TCP f30c58887d4b:37120->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   14u     IPv4 190271668      0t0       TCP *:30303 (LISTEN)
strato-p2  75 root   15u     IPv4 299249949      0t0       TCP f30c58887d4b:45888->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   16u     IPv4 299249953      0t0       TCP f30c58887d4b:45890->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   17u     IPv4 196846433      0t0       TCP f30c58887d4b:30303->ec2-3-216-60-69.compute-1.amazonaws.com:44036 (ESTABLISHED)
strato-p2  75 root   18u     IPv4 196853986      0t0       TCP f30c58887d4b:30303->ec2-3-220-195-204.compute-1.amazonaws.com:46568 (ESTABLISHED)
strato-p2  75 root   19u     IPv4 196858783      0t0       TCP f30c58887d4b:30303->ec2-3-221-37-62.compute-1.amazonaws.com:42290 (ESTABLISHED)
strato-p2  75 root   20u     IPv4 196846440      0t0       TCP f30c58887d4b:38716->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   21u     IPv4 299249957      0t0       TCP f30c58887d4b:45892->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   23u     IPv4 190274197      0t0       TCP f30c58887d4b:10248->strato_prometheus_1.strato_static:60030 (ESTABLISHED)
strato-p2  75 root   25u     IPv4 196858789      0t0       TCP f30c58887d4b:39694->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   26u     IPv4 196855045      0t0       TCP f30c58887d4b:39190->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   28u     IPv4 190279538      0t0       TCP f30c58887d4b:38188->172.20.0.1:30303 (ESTABLISHED)
strato-p2  75 root   29u     IPv4 190279542      0t0       TCP f30c58887d4b:30303->172.20.0.1:41388 (ESTABLISHED)
strato-p2  75 root   33u     IPv4 209609561      0t0       TCP f30c58887d4b:41822->strato_postgres_1.strato_static:postgresql (ESTABLISHED)
strato-p2  75 root   36u     IPv4 190277435      0t0       TCP f30c58887d4b:38166->strato_kafka_1.strato_static:9092 (ESTABLISHED)
strato-p2  75 root   38u     IPv4 190277445      0t0       TCP f30c58887d4b:38172->strato_kafka_1.strato_static:9092 (ESTABLISHED)
```
The peer connections here are the ones connected to an `ec2` instance, and the
files are 17, 18, and 19. We can see as well that this node is the server side
for each of these connections, since we are on port 30303 and the peer is on a
port chosen by the networking stack. We can see as well that we are listening
on 30303 (for p2p) and on 10248 (for the /metrics route).

If the strato container is run in privileged mode, `gdb` can attach to a
process inside of the container. This is typically not the case, and you need
to attach to `strato-p2p` as a process on the host (note that it will have a
different PID in the host namespace)
```
host> sudo apt install gdb
host> sudo gdb -p $(pgrep --exact strato-p2p)
GNU gdb (Ubuntu 8.1-0ubuntu3) 8.1.0.20180409-git
Copyright (C) 2018 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>
This is free software: you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.  Type "show copying"
and "show warranty" for details.
This GDB was configured as "x86_64-linux-gnu".
Type "show configuration" for configuration details.
For bug reporting instructions, please see:
<http://www.gnu.org/software/gdb/bugs/>.
Find the GDB manual and other documentation resources online at:
<http://www.gnu.org/software/gdb/documentation/>.
For help, type "help".
Type "apropos word" to search for commands related to "word".
Attaching to process 21071
[New LWP 21088]
[New LWP 21089]
[New LWP 21112]
[New LWP 21115]
[New LWP 21125]
[New LWP 21385]
[New LWP 22818]
[New LWP 22883]
[Thread debugging using libthread_db enabled]
Using host libthread_db library "/lib/x86_64-linux-gnu/libthread_db.so.1".

warning: Target and debugger are in different PID namespaces; thread lists and other data are likely unreliable.  Connect to gdbserver inside the container.
0x00007f86caadc9f3 in futex_wait_cancelable (private=<optimized out>, expected=0, futex_word=0x530a148)
    at ../sysdeps/unix/sysv/linux/futex-internal.h:88
88      ../sysdeps/unix/sysv/linux/futex-internal.h: No such file or directory.
(gdb) call close(17)
$1 = 0
(gdb) quit
A debugging session is active.

        Inferior 1 [process 21071] will be detached.

Quit anyway? (y or n) y
Detaching from program: target:/usr/local/bin/strato-p2p, process 21071
```
After detaching, the p2p process will resume and you can see the thread exiting:
```
[2019-07-29 18:52:52.500303579 UTC]  INFO | ThreadId 21878 | runEthServer/exit                   |  * Connection ended to 3.216.60.69
```

### How do I run my own docker registry?
This section should maybe instead be labeled `why should you`? The essential
reason I've had is that when compiling with profiling enabled, the strato image
is typically 5GB and the blockapps registry fails to accept images that large.
An additional reason is that these are images that I'm testing with, but they
are large and nobody else will need to run them. Rather than pollute S3 with
them forever, they just get lost when I decide to down the registry.

Point the DNS records for a hostname you have to the VM, and modify the following
to taste:
```
#!/usr/bin/env zsh

sudo docker run  \
  -d \
  --restart=always \
  --name localreg \
  --mount type=bind,source=/etc/letsencrypt/,target=/etc/letsencrypt,readonly=true \
  --mount type=bind,source="${PWD}/auth",target=/auth,readonly=true \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -e REGISTRY_HTTP_ADDR=0.0.0.0:443 \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/etc/letsencrypt/live/thnd.dev/fullchain.pem \
  -e REGISTRY_HTTP_TLS_KEY=/etc/letsencrypt/live/thnd.dev/privkey.pem \
  -p 443:443 \
  registry:2
```
Since the .dev TLD is on the HSTS list, it was necessary to enable SSL. The certificates
from Let's Encrypt were mounted on the container, the `registry:2` image also has
an htpasswd executable:
```
docker run --entrypoint htpasswd registry:2 -Bbn thnd c5e7f38d665b95f7fb357e904a99852d > auth/htpasswd
```
Then for the nodes that need to pull from the registry, login:
```
docker login --username thnd --password c5e7f38d665b95f7fb357e904a99852d thnd.dev
```

To build, specify the REPO_URL directly and push at will:
```
REPO_URL=thnd.dev/ make && docker-compose -f docker-compose.push.yml push
```

### How do I deploy a multinode network?
A tool I've found pretty useful is `parallel-ssh`. If I'm just executing a one off,
it might make sense to do `for node in <network-name>{0,1,2,3}; do ssh $node <command>; done`,
but a lot of times its nice to just have to type in a single command and for some common
tasks (pulling images, restarting containers) they can take between 10s and minutes, so
parallelization is definitely noticed. I also think that Ansible would be a good fit here,
especially because it seems to have the capability of parallel-ssh but with the ability
to have a cleaner separation between network definitions and command definition.

Here is an example transcript of taking a trio of (essentially) fresh nodes and spin them up into a network:
```
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ alias doall='parallel-ssh --timeout 0 --inline -H multinode303 -H multinode304 -H multinode305'
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ alias sendall='parallel-ssh --timeout 0 -H multinode303 -H multinode304 -H multinode305'
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall 'rm -rf /tmp/sgs && git clone https://github.com/blockapps/strato-getting-started /tmp/sgs'
[1] 19:11:13 [SUCCESS] multinode305
Stderr: Cloning into '/tmp/sgs'...
warning: unable to access '/home/ubuntu/.config/git/attributes': Permission denied
[2] 19:11:14 [SUCCESS] multinode304
Stderr: Cloning into '/tmp/sgs'...
warning: unable to access '/home/ubuntu/.config/git/attributes': Permission denied
[3] 19:11:14 [SUCCESS] multinode303
Stderr: Cloning into '/tmp/sgs'...
warning: unable to access '/home/ubuntu/.config/git/attributes': Permission denied
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall 'sudo chown -R ubuntu /home/ubuntu/.config'
[1] 19:12:31 [SUCCESS] multinode305
[2] 19:12:31 [SUCCESS] multinode303
[3] 19:12:31 [SUCCESS] multinode304
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ cat << EOF >| node-list.json
heredoc else> [ {"host": "multinode303.ci.blockapps.net"},
heredoc else>   {"host": "multinode304.ci.blockapps.net"},
heredoc else>   {"host": "multinode305.ci.blockapps.net"}
heredoc else> ]
heredoc else> EOF
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ ./strato --scriptgen
IP address of multinode303.ci.blockapps.net was resolved as 52.23.161.240
IP address of multinode304.ci.blockapps.net was resolved as 18.213.3.139
IP address of multinode305.ci.blockapps.net was resolved as 54.242.60.210
Resulting node list: [{"ip": "52.23.161.240", "host": "multinode303.ci.blockapps.net"}, {"ip": "18.213.3.139", "host": "multinode304.ci.blockapps.net"}, {"ip": "54.242.60.210", "host": "multinode305.ci.blockapps.net"}]
STRATO image used: strato:4.5.0-4e1cfb7b7
{
    "key_address_pairs": [
        {
            "address": "4a36a59bca3041cef4a2557d3d3800a4adbd0bab",
            "private_key": "Uk3iQPbSfEnjWks84yQbNwrgCt30SMVx3tmVBwySY90="
        },
        {
            "address": "8ec10d0fc7df376edd86079dd060cd294b62b8ea",
            "private_key": "6fMus90cd/JumvT8Y+FH8Wyhw3TQwurF6G9KHwRG6ms="
        },
        {
            "address": "c95fddfb53d349f00bcfcb1b2d7da12410e31d53",
            "private_key": "VNI+VCpNLvfIm9RNq7XeSX2MDIi+hf8az3hnBGmM80U="
        }
    ],
    "all_validators": [
        "4a36a59bca3041cef4a2557d3d3800a4adbd0bab",
        "8ec10d0fc7df376edd86079dd060cd294b62b8ea",
        "c95fddfb53d349f00bcfcb1b2d7da12410e31d53"
    ]
}

Successfully finished. Check my-node-scripts/ directory for scripts
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ for node in multinode30{3,4,5}; do
for else> scp "my-node-scripts/${node}.ci.blockapps.net/run.sh" $node:/tmp/sgs
for else> done
run.sh                        100%  413   878.6KB/s   00:00
run.sh                        100%  413   859.4KB/s   00:00
run.sh                        100%  414     1.0MB/s   00:00

tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ sendall docker-compose.yml /tmp/sgs
[1] 19:17:59 [SUCCESS] multinode304
[2] 19:17:59 [SUCCESS] multinode303
[3] 19:17:59 [SUCCESS] multinode305
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ md5sum docker-compose.yml
2c02add90be9d08c00644feecf3899da  docker-compose.yml
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall md5sum /tmp/sgs/docker-compose.yml
[1] 19:22:21 [SUCCESS] multinode304
2c02add90be9d08c00644feecf3899da  /tmp/sgs/docker-compose.yml
[2] 19:22:21 [SUCCESS] multinode305
2c02add90be9d08c00644feecf3899da  /tmp/sgs/docker-compose.yml
[3] 19:22:22 [SUCCESS] multinode303
2c02add90be9d08c00644feecf3899da  /tmp/sgs/docker-compose.yml
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall 'cd /tmp/sgs && ./strato --wipe && ./strato --pull && ./run.sh'
<omitted>
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall 'curl --silent -F address=3 localhost/strato-api/eth/v1.2/faucet'
[1] 19:20:47 [SUCCESS] multinode304
["c6c07dcdec6fecc36b69159591c0ab74a17bcef35e33a5921359da39a7d27002","e3920aa981dc05b65fe201701db3e704ef8f2a6f6bc9c9aeaa88e7f82964fe46"][2] 19:20:47 [SUCCESS] multinode303
["0b63b6d467c733fdb8cb924b9e7ae1438ffa39b67427df43dbf55ac9d462bea1","abd64f1e9b534767c3e0a0f86a42eeefd58bc8145f2fadc9741490079ee09fd1"][3] 19:20:47 [SUCCESS] multinode305
["12c8a2710afa3f45499154a54b856a91b175c2d6ffe7692956d31b1f9a22fc36","fb1a7ed566156cb2c712d199e73b67882c60744717d51639fd4779d5dc264d75"]%
tim@ip-172-31-11-233 ~/strato-getting-started ❯❯❯ doall 'docker exec strato_strato_1 curl --silent localhost:8050/metrics | grep view'
[1] 19:20:29 [SUCCESS] multinode305
# HELP pbft_current_view Current (Roundno, Seqno) of PBFT
# TYPE pbft_current_view gauge
pbft_current_view{view_field="round_number"} 9.0
pbft_current_view{view_field="sequence_number"} 2.0
[2] 19:20:29 [SUCCESS] multinode304
# HELP pbft_current_view Current (Roundno, Seqno) of PBFT
# TYPE pbft_current_view gauge
pbft_current_view{view_field="round_number"} 9.0
pbft_current_view{view_field="sequence_number"} 2.0
[3] 19:20:30 [SUCCESS] multinode303
# HELP pbft_current_view Current (Roundno, Seqno) of PBFT
# TYPE pbft_current_view gauge
pbft_current_view{view_field="round_number"} 9.0
pbft_current_view{view_field="sequence_number"} 2.
```

### How do I view metrics?
To view the raw prometheus input data, each instrumented process will serve HTTP requests to
a /metrics endpoint. For every sample exported, there is a line with the metric name, a
comma separated list of label pairs inside curly braces, and a floating point number corresponding
to the value of the metric.

To execute more complex queries (perhaps with history), normal queries can be URL encoded and excuted
against the API:
```
curl --silent 'http://3.95.216.65:8080/prometheus/api/v1/query?query=vm_loop_timer%7Bloop_section%3D%22one%20full%20loop%22%7D&_=1563215892117' | jq .
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "__name__": "vm_loop_timer",
          "instance": "3.95.216.65:8080",
          "job": "vm-runner",
          "loop_section": "one full loop",
          "quantile": "0.5"
        },
        "value": [
          1563292607.978,
          "100.004883927"
        ]
      },
      {
        "metric": {
          "__name__": "vm_loop_timer",
          "instance": "3.95.216.65:8080",
          "job": "vm-runner",
          "loop_section": "one full loop",
          "quantile": "0.9"
        },
        "value": [
          1563292607.978,
          "100.007825452"
        ]
      },
      {
        "metric": {
          "__name__": "vm_loop_timer",
          "instance": "3.95.216.65:8080",
          "job": "vm-runner",
          "loop_section": "one full loop",
          "quantile": "0.99"
        },
        "value": [
          1563292607.978,
          "100.010408168"
        ]
      }
    ]
  }
}
```

If this is for a human rather than a tool, browse to `<hostname>/prometheus`. Here you can
create an ad-hoc dashboard by choosing the metrics to graph or display latest value. Queries
can filter the metric on the labels specified, or determine the rate for each 1 minute interval,
or anything else supported by the query language: https://prometheus.io/docs/prometheus/latest/querying/basics/

### How do make an in-database copy of postgres tables?
It doesn't seem possible to use the metadata query to get the table names to then create new commands in
just SQL, but it can be done using one of the other programming languages that postgres supports.
Here is an example in PL/pgSQL that creates a copy of all the history tables with a timestamp
in their name of the time the snapshot was created. The file can be loaded with the `-f` flag
to psql, and a backup created with `select backup_history();`.

```
DROP FUNCTION IF EXISTS backup_history();

CREATE FUNCTION backup_history() RETURNS VOID AS $$
DECLARE
  table_name text;
  backup_table text;
BEGIN
  FOR table_name in SELECT tablename
                    FROM pg_catalog.pg_tables
                    WHERE schemaname = 'public'
                        AND tablename LIKE 'history@%'
                        AND tablename NOT LIKE '%backup%'
  LOOP
    backup_table := table_name || '_backup_' || now();
    EXECUTE 'CREATE TABLE ' || quote_ident(backup_table) || ' AS TABLE ' || quote_ident(table_name);
  END LOOP;
  RETURN;
END $$ LANGUAGE plpgsql;
```


### How do I resynchronize a PBFT network?
The first step is see that all nodes are healthy. If a node has died, in some
circumstances (e.g. a memory leak) you should be able to `docker restart strato_strato_1`
on that node and just catch up on the missing blocks.

If the node is live and the sequence number is behind, this is likely a p2p issue. Check
that messages are being sent/received on either the p2p logs or metrics. If it is not,
check that ethereum-discover is making requests to the boot node, that the boot node is
the right one for this network, and that the boot node is accepting requests, and
check that peers are accepting handshake requests, that the enable time in postgres
is not far in the future, and that the peer isn't accidentally marked as active.
If p2p is healthy and sync is not automatically working, you can try to fetch
the missing blocks with `qs askforblocks --start-block=<have+1> --end-block=<need> --peer=<address_with_blocks>`.

If the round number on this node is not correct but there is otherwise quorum on a round number,
p2p is likely not connected enough to see the round changes from all peers.
Checking `p_peer` might show that e.g. we only know of one peer, the peers are mistakenly
marked as active but have no threads working on them, or that we have blacklisted the peer
for being unresponsive and we're waiting 4 hours to try to connect to them again.

When there is not quorum on a round number, historically this meant that the network was stuck until
a quorum of nodes were restarted to be synchronized on round number 0. Instead nowadays when this
happens, you can increase the round number on some nodes in order to try to realign things:
`docker exec strato_strato_1 forced-config-change --round_number=812` (this should probably be moved
into queryStrato). Note however that `forced-config-change` cannot move the round number backwards.
