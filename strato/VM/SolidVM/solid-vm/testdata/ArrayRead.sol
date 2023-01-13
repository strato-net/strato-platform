contract qq {
  int[] xs;
  int y;
  int z;
  constructor() public {
    xs.push(0x5577);
    xs.push(0xffff);
    y = xs[0];
    z = xs[1];
  }
}
