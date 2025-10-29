// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Describe_ExecutionOrder {

  function beforeAll() {
  }

  function beforeEach() {
  }

  function it_B() {
    log("Calling B");
  }

  function it_A() {
    log("Calling A");
  }

}