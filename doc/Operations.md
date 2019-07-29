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

Compilition of the binary will likely still be a bottleneck,
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
From 4.5.0 on, every process created with a haskell binary* has a signal handler installed that will catch
a SIGHUP and exec itself. What this affords is is the ability to reset memory on a process or swap out
the executable, while retaining the supervision from doit.sh. The trick here is that historically,
process creation has consisted of two parts: `fork` uses the same process image but creates a new copy,
and `exec` changes the process image in place. We don't fork here, so the process is just replaced.
The same `argv` is used and so flags are not changed, and the environment is inherited from the original
process.

There are some caveats to this trick. If used on a process that doesn't support this, the default
handler for SIGHUP is termination. Then doit.sh will terminate all processes. In 4.5.0, all
executables should install the handler (through calling `blockappsInit`), but its probably worth
checking before trying this in production and `blockappsInit` should be called at the start
of `main` for all new long lived processes.

The other caveat is that files opened by the original process should have CLOEXEC (close-on-exec).
Libraries like `leveldb` and `wai` should be doing this already (or something else to simulate
the behavior), but there was a bug in implementing this where the file descriptor used to listen
on port 30303 stayed open in `strato-p2p`, and it was not able to reaquire it for listening.

The process should also be designed to be able to restart itself normally, by either being stateless
(like strato-p2p) or saving the necessary state somewhere persistent (like strato-sequencer with
the kafka metadata).

### How do I pause a node?
I've never tried `docker pause strato_strato_1`, but it should halt all processes and be able
to resume them with `docker unpause strato_strato_1`. If you just want to stop a branch of
inputs/outputs to prevent the node from doing damage or isolate it for debugging, a SIGSTOP
will pause the process that can be resumed with SIGCONT:
```docker exec strato_strato_1 pkill --exact --echo strato-p2p\|strato-api```
(Note that /proc/<pid/>stat has an upper bound of 15 characters for the process name, so
pkill has a bizarre upper bound of 15 characters in the process name, and needs either
--full or a truncated process name to target correctly:
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
```. In this case `reload_ht3` will `cd strato-getting-started && ./strato --wipe && ./strato```
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
a long time on each one. As simpler example of looking for the introduction of a certain variable,
```
git bisect start
git bisect bad develop
git bisect good c39e09
git bisect run grep currentBaggerSR core-strato/ethereum-vm/src/Blockchain/BlockChain.hs
```


