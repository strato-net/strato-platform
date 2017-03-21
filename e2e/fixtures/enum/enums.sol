contract ItemEnum {

/*
*/  
    enum ItemEnum {
        NULL,
        SAMPLE,
        REPORT
    }

    enum StateEnum {
        NULL,
        PLANNED,
        COLLECTED,
        SHIPPED,
        RECEIVED,
        ANALYZED,
        STORED,
        SPLIT,
        DESTROYED,
        CREATED,
        FINALIZED,
        ARCHIVED
    }

    function getChild() returns (address) {
      address child = new Child();
      return child;
    }
    function getUint() returns (uint) {
      return 666;
    }


}
