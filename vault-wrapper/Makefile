BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BUILDER_HOME=$(BASILWORK_ABS)/builder_home

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BUILDER_HOME)

build_haskell: prebuild
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_docker: build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(FAKEROOT)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
