ifeq ($(DOCKER_TAG),)
  $(error DOCKER_TAG is not set)
endif

all: build

build:
	docker build -t $(DOCKER_TAG) .
	@if [ -n "$(DOCKER_TAG_ALIAS)" ]; then docker tag $(DOCKER_TAG) $(DOCKER_TAG_ALIAS); fi
