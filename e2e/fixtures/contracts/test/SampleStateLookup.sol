import "./Enumerable.sol";
import "../enums/SampleState.sol";

contract SampleStateLookup is SampleState, Enumerable {
    mapping (string => SampleStateEnum) enumMap;

    function enumLookup(string name) constant returns (SampleStateEnum) {
        return enumMap[name];
    }

    function reverseEnumLookup(SampleStateEnum id) constant returns (string) {
        return reverseEnumMap[uint(id)];
    }

    function add(string name, SampleStateEnum id) {
        enumMap[name] = id;
        reverseEnumMap[uint(id)] = name;
    }

    function SampleStateLookup() {
        add("NULL", SampleStateEnum.NULL);
        add("START", SampleStateEnum.START);
        add("PLANNED", SampleStateEnum.PLANNED);
        add("COLLECTED", SampleStateEnum.COLLECTED);
        add("COLLECTED_SPLIT", SampleStateEnum.COLLECTED_SPLIT);
        add("RECEIVED_SPLIT", SampleStateEnum.RECEIVED_SPLIT);
        add("SHIPPED", SampleStateEnum.SHIPPED);
        add("RECEIVED", SampleStateEnum.RECEIVED);
        add("ANALYZED", SampleStateEnum.ANALYZED);
        add("STORED", SampleStateEnum.STORED);
        add("SPLIT", SampleStateEnum.SPLIT);
        add("DESTROYED", SampleStateEnum.DESTROYED);
        add("END", SampleStateEnum.END);
    }
}
