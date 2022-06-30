contract qq {
  mapping(uint => uint) xs;
  uint y;
  uint z;

  constructor() {
    xs[400] = 343;
    y = xs[400];
    z = xs[401];
  }
}
