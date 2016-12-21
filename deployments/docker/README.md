= STRATO Docker images =

The Docker setup is increasingly intricate but is (hopefully) managed by some
scripts and by docker-compose.  Each container keeps its persistent data in an
anonymous volume, so it is safe if the images are upgraded.

Every script mentioned below picks up on the following environment variables:

 - stratoVersion: the version tag for the Docker images; by default, `latest`.
 - stratoRepository: the Docker "repository" name; by default, `blockapps`.
 - stratoRegistry: the Docker registry; by default, `auth.blockapps.net:5000`.
 - stratoHost: the hostname or IP address at which the containers, when run,
   will consider themselves running; by default, the public IP address of the
   hosting machine.  This is useful if, for example, you wish to reach the
   containers at a local address rather than a public address.

== Building ==

The main build script is `build-all`.  It presumes that:

 - This repository (deployments) is in the `strato` meta-repo.
 - Both `bloc` and `strato-explorer`, under those names, are cloned within the meta-repo as well.
 - The Haskell sources have already been compiled with `stack build` inside `strato`.

`./build-all [--push]` creates, tags, and optionally pushes all the Docker images.

== Scripts ==

Simply, run `./init-strato.sh`.  If you stop the containers, restart them with
`./start-strato.sh`.  Use `./pull-strato.sh` to pull updated images and then
`./start-strato.sh` to update your containers.  `./stop-strato.sh` will stop
_and delete_ the containers.

== The images ==

The product is completely modularized, with each image having little more than
the executables for its particular service.  We reuse standard images as much
as possible, though more work can be done in simplifying the set of base
images.

=== blockapps/strato ===

Contains all the STRATO runtime binaries and also `strato-setup`, which it runs
on start.

=== blockapps/globaldb ===

This tiny image contains just a binary to create the `blockchain` database used
by all the blockapps/strato containers.  It must run (and exit) before these
containers start, but that is ensured by the `start-strato.sh` script.

=== blockapps/nginx ===

We use a reverse-proxy server so that many blockapps/strato containers can run
and their api ports all allow traffic at predictable public addresses.  Those
addresses are `http://<hostname Docker is running on>/<container id>`, alas,
since Docker provides no other way to uniquely address containers in a network.

The server also proxies `bloc` (see below) at the `/bloc` path.

In all cases, subpaths are correctly proxied, so queries work.

Although the api pages work quite well, assets required by the bloc pages are
not all loaded, and I couldn't make the explorer work at all with nginx.

=== blockapps/bloc ===

This runs bloc as a server on port 8000, which is bound to the host as well as
to the reverse proxy.

=== blockapps/explorer ===

This runs explorer as a server on port 9000.  All the blockapps/strato
containers register themselves with this one using their proxied addresses, so
the explorer at `http://<docker's host's name>:9000/stats` works normally.

=== blockapps/kafka ===

A very slightly modified version of `wurstmeister/kafka` to allow
`kafka-topics.sh` to be called over TCP port 1234.

=== wurstmeister/zookeeper ===

=== postgres ===
