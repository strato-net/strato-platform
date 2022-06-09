contract qq {
  struct X {
    uint a;
    uint b;
  }
  X[] xs;
  constructor() {
    X x;
    x.a = 9000;
    x.b = 3000;
    xs.push(x);
  }
}
