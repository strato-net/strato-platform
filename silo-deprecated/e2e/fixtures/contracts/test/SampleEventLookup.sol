import "./Enumerable.sol";
import "../enums/SampleEvent.sol";

contract SampleEventLookup is SampleEvent, Enumerable {
    mapping (string => SampleEventEnum) enumMap;

    function enumLookup(string name) constant returns (SampleEventEnum) {
        return enumMap[name];
    }

    function reverseEnumLookup(SampleEventEnum id) constant returns (string) {
        return reverseEnumMap[uint(id)];
    }

    function add(string name, SampleEventEnum id) {
        enumMap[name] = id;
        reverseEnumMap[uint(id)] = name;
    }

    function SampleEventLookup() {
        add("NULL", SampleEventEnum.NULL);
        add("PLAN", SampleEventEnum.PLAN);
        add("DRILL", SampleEventEnum.DRILL);
        add("SHIP", SampleEventEnum.SHIP);
        add("ACK", SampleEventEnum.ACK);
        add("ATTACH_REPORT", SampleEventEnum.ATTACH_REPORT);
        add("STORE", SampleEventEnum.STORE);
        add("SPLIT_RECEIVED", SampleEventEnum.SPLIT_RECEIVED);
        add("DESTROY", SampleEventEnum.DESTROY);
        add("SPLIT_COLLECTED", SampleEventEnum.SPLIT_COLLECTED);
    }
}
