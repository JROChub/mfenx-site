// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

/// @notice Executable validator acceptance contract, not an asset or token.
contract MFENXExecutionProbe {
    address public immutable owner;
    uint256 public value;
    event Changed(address indexed writer, uint256 previous, uint256 current);
    constructor() { owner = msg.sender; }
    function set(uint256 next) external {
        require(msg.sender == owner, "owner");
        uint256 previous = value;
        value = next;
        emit Changed(msg.sender, previous, next);
    }
    function revertAfterStore(uint256 next) external {
        value = next;
        emit Changed(msg.sender, 0, next);
        revert("rollback");
    }
    function multiply(uint256 left, uint256 right) external pure returns (uint256) {
        return left * right;
    }
    function nested(address target, bytes calldata input) external returns (bytes memory) {
        (bool ok, bytes memory output) = target.call(input);
        require(ok, "nested call");
        return output;
    }
    function context() external view returns (uint256, uint256, uint256, bytes32) {
        return (block.chainid, block.number, block.timestamp, blockhash(block.number - 1));
    }
    function burnGas() external { while (true) { value += 1; } }
}
