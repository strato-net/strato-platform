package main

import (
	"flag"
	"net"

	"github.com/golang/glog"
)

var portNumber = flag.Int("port", 13240, "UDP port to listen on")

func main() {
	flag.Parse()
	glog.Info("Contrails (whoosh)")
	laddr := net.UDPAddr{Port: *portNumber}
	conn, err := net.ListenUDP("udp", &laddr)
	if err != nil {
		glog.Fatalf("unable to listen: %v", err)
	}
	var (
		buf [0x8000]byte
		oob [0x8000]byte
	)
	for {
		n, oobn, flags, raddr, err := conn.ReadMsgUDP(buf[:], oob[:])
		if err != nil {
			glog.Errorf("Failed packet read: %v", err)
			continue
		}
		glog.Infof("Packet from %v, (%d bytes, %d bytes oob, flags: %b)", raddr, n, oobn, flags)
		glog.Infof("buf: %s", buf[:n])
		glog.Infof("oob: %s", oob[:oobn])
	}
}
