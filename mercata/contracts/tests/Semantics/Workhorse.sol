// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract Workhorse {
    event Progress(uint i);
    uint public v;
    function loopForever() external {
        uint i = 0;
        while (true) {
            i++;
            if (i % 200000 == 0) {
                emit Progress(i);
            }
        }
    }

    function mutateThenLoop(uint d) external {
        v += d;
        uint i = 0;
        while (true) {
            i++;
            if (i % 200000 == 0) {
                emit Progress(i);
            }
        }
    }
}


