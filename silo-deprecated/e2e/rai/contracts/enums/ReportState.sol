contract ReportState {
    mapping (bytes32 => ReportStateEnum) enumMap;
    enum ReportStateEnum {
        NULL,
        START,
        CREATED,
        FINALIZED,
        SHIPPED,
        RECEIVED,
        ARCHIVED,
        END
    }

    function enumLookup(bytes32 name) returns (ReportStateEnum) {
        return enumMap[name];
    }

    function ReportState() {
        enumMap["NULL"] = ReportStateEnum.NULL;
        enumMap["START"] = ReportStateEnum.START;
        enumMap["CREATED"] = ReportStateEnum.CREATED;
        enumMap["FINALIZED"] = ReportStateEnum.FINALIZED;
        enumMap["SHIPPED"] = ReportStateEnum.SHIPPED;
        enumMap["RECEIVED"] = ReportStateEnum.RECEIVED;
        enumMap["ARCHIVED"] = ReportStateEnum.ARCHIVED;
        enumMap["END"] = ReportStateEnum.END;
    }
}
