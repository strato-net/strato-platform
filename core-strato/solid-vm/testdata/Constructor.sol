contract qq {
    function f() public pure {}
    constructor() public {
        qq c = this;
        c.f(); // this does not warn now, but should warn in the future
        this.f();
        (this).f();
    }
}
