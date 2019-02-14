BASILWORK=$(shell pwd)/.basil-work
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BLOCHOME=$(FAKEROOT)/usr/bin/bloc
LICENSE_DIR=$(FAKEROOT)/licenses
LICENSE_SOURCE_DIR=$(LICENSE_DIR)/sources
SLIPSTREAM=${FAKEROOT}/usr/bin/slipstream

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BLOCHOME)
	mkdir -p $(LICENSE_SOURCE_DIR)


$(FAKEROOT)/usr/bin/solc-0.4: prebuild
	./pull_solc.sh 0.4.25 $@ $(LICENSE_SOURCE_DIR)/solidity-0.4

$(FAKEROOT)/usr/bin/solc-0.5: prebuild
	./pull_solc.sh 0.5.2 $@ $(LICENSE_SOURCE_DIR)/solidity-0.5

$(FAKEROOT)/usr/bin/solc: $(FAKEROOT)/usr/bin/solc-0.4 $(FAKEROOT)/usr/bin/solc-0.5
	ln -f $< $@

build_haskell: prebuild $(FAKEROOT)/usr/bin/solc
	stack build --test --no-run-tests \
        --bench --no-run-benchmarks \
        --copy-bins --local-bin-path=$(FAKEROOT)/usr/bin

build_haskell_profiled: prebuild build_solidity
	stack build --profile --work-dir .stack-work-profile \
        --test --no-run-tests \
        --bench --no-run-benchmarks \
        --copy-bins --local-bin-path=$(FAKEROOT)/usr/bin

build_docker: build_haskell $(FAKEROOT)/usr/bin/solc
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-strato-server $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-bloc $(BLOCHOME)
	cp -fr licenses/* ${LICENSE_DIR}
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
