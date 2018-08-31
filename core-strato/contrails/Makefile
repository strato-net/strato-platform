GO_VERSION=$(shell (go version | cut -d ' ' -f 3))

ifneq ($(GO_VERSION), go1.11)
  $(error "go 1.11 is not installed. See https://golang.org/dl/ for instructions.")
endif

GOPATH=$(PWD)/.go-work
all: | $(GOPATH)
	GOPATH=$(GOPATH) GO111MODULE=on go get ./...
	GOPATH=$(GOPATH) GO111MODULE=on go install .

$(GOPATH):
	mkdir -p $(GOPATH)

clean:
	rm -rf $(GOPATH)

install:
	install $(GOPATH)/bin/* $(BINDIR)

run: all
	$(GOPATH)/bin/contrails
