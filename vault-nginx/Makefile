ifeq ($(DOCKER_TAG),)
  $(error DOCKER_TAG is not set)
endif

all: build

build:
	docker build --add-host=openresty.org:3.125.51.27 -t $(DOCKER_TAG) .
	@if [ -n "$(DOCKER_TAG_ALIAS)" ]; then docker tag $(DOCKER_TAG) $(DOCKER_TAG_ALIAS); fi
