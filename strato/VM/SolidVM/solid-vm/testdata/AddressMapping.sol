contract qq {
  mapping(address => uint) perms;
  constructor() {
    perms[0xdeadbeef] = 0xfff;
  }
}
