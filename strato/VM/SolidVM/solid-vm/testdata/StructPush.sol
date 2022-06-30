contract qq {
  struct X {
    int a;
    int b;
  }
  X[] xs;
  constructor() {
    xs.push(X(88, 73));
  }
}
