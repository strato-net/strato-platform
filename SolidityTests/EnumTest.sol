contract EnumTest{

enum shapes{Triangle,Square,Rectangle}

shapes shape1;
shapes shape2;
shapes shape3;

constructor(){

shape1 = shapes.Triangle;
shape2 = shapes.Square;
shape3 = shape1;

}
}