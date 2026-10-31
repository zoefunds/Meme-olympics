// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../MemeOlympicsEscrow.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function warp(uint256) external;
}

/// @dev Minimal Foundry surface, deliberately inlined so the test needs no
/// dependency beyond forge-std's cheat-code runner.
contract MemeOlympicsEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC private token;
    MemeOlympicsEscrow private escrow;
    address private constant RELAYER = address(0xA11CE);
    address private constant WINNER = address(0xB0B);
    bytes32 private constant COMPETITION = keccak256("lifecycle-test");

    function setUp() public {
        token = new MockUSDC();
        escrow = new MemeOlympicsEscrow(address(token), RELAYER);
        token.mint(address(this), 1_000_000);
        token.approve(address(escrow), 1_000_000);
        escrow.fundCompetition(COMPETITION, 1_000_000);
    }

    function testClaimIsBlockedUntilChallengeEnds() public {
        uint256 release = block.timestamp + 1 days;
        vm.prank(RELAYER);
        escrow.setWinners(COMPETITION, _one(WINNER), _one(1_000_000), release);

        vm.expectRevert(bytes("MemeOlympicsEscrow: challenge period active"));
        vm.prank(WINNER);
        escrow.claim(COMPETITION);

        vm.warp(release);
        vm.prank(WINNER);
        escrow.claim(COMPETITION);
        require(token.balanceOf(WINNER) == 1_000_000, "winner was not paid");
    }

    function testAllocationCannotBeWrittenTwice() public {
        vm.prank(RELAYER);
        escrow.setWinners(COMPETITION, _one(WINNER), _one(1_000_000), block.timestamp + 1);
        vm.expectRevert(bytes("MemeOlympicsEscrow: winners already set"));
        vm.prank(RELAYER);
        escrow.setWinners(COMPETITION, _one(WINNER), _one(1_000_000), block.timestamp + 1);
    }

    function testAllocationAndClaimAfterChallengePeriod() public {
        uint256 release = block.timestamp + 1 days;
        vm.warp(release + 1);

        vm.prank(RELAYER);
        escrow.setWinners(COMPETITION, _one(WINNER), _one(1_000_000), release);

        vm.prank(WINNER);
        escrow.claim(COMPETITION);
        require(token.balanceOf(WINNER) == 1_000_000, "post-challenge claim failed");
    }

    function _one(address item) private pure returns (address[] memory result) {
        result = new address[](1);
        result[0] = item;
    }

    function _one(uint256 item) private pure returns (uint256[] memory result) {
        result = new uint256[](1);
        result[0] = item;
    }
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    function mint(address to, uint256 amount) external { balances[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount; balances[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowance = allowances[from][msg.sender];
        if (allowance != type(uint256).max) allowances[from][msg.sender] = allowance - amount;
        balances[from] -= amount; balances[to] += amount; return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) { allowances[msg.sender][spender] = amount; return true; }
    function balanceOf(address account) external view returns (uint256) { return balances[account]; }
    function decimals() external pure returns (uint8) { return 6; }
}
