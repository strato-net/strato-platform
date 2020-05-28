contract qq {
  uint[] x;
  constructor() {
    x.push(317);
    x.push(318);
    x.push(319);
    delete x;
  }
}
