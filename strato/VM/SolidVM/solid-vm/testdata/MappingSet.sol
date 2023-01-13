contract qq {
  mapping(uint => uint) us;
  constructor() {
    us[22] = 4;
    us[999999] = 21;
  }
}
