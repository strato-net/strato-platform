BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
FAKEROOT=$(BASILWORK)/fakeroot

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p /tmp/docker-dummy-vault-wrapper

build_haskell: prebuild
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_docker: build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(FAKEROOT)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy-vault-wrapper
