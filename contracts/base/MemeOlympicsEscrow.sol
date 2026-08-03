// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MemeOlympicsEscrow
/// @notice Payment layer for Meme Olympics, deployed on Base Sepolia. Holds
///         real USDC prize pools per competition and lets winners self-claim.
///         Judging (scores, plagiarism gate, winner ranking) happens entirely
///         off this chain, on GenLayer (contracts/meme_olympics.py) — this
///         contract only ever sees a competition id, a winners list, and USDC
///         amounts pushed here by a trusted relayer after GenLayer finalizes.
/// @dev No external dependencies (no OpenZeppelin import) so it can be
///      compiled/deployed with nothing more than solc — copy in OZ's
///      IERC20/SafeERC20/ReentrancyGuard later if this moves past a testnet
///      hackathon build.
// ----------------------------------------------------------------------
// Minimal ERC20 interface (USDC on Base Sepolia).
// ----------------------------------------------------------------------
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract MemeOlympicsEscrow {
    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    struct Pool {
        uint256 deposited;   // total USDC ever deposited under this competition id
        uint256 allocated;   // total USDC committed to winners via setWinners
        bool winnersSet;     // true once setWinners has run (idempotency gate)
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer; // backend service authorized to push winner lists

    mapping(bytes32 => Pool) public pools;                         // competitionId => pool
    mapping(bytes32 => mapping(address => uint256)) public claimable; // competitionId => winner => USDC owed
    mapping(address => uint256) public totalClaimable;              // winner => USDC owed across ALL competitions

    bool private _locked; // reentrancy guard

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event Deposited(bytes32 indexed competitionId, address indexed from, uint256 amount);
    event WinnersSet(bytes32 indexed competitionId, uint256 winnerCount, uint256 totalAllocated);
    event Claimed(bytes32 indexed competitionId, address indexed winner, uint256 amount);
    event RelayerUpdated(address indexed newRelayer);
    event OwnerUpdated(address indexed newOwner);
    event UnallocatedWithdrawn(bytes32 indexed competitionId, address indexed to, uint256 amount);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier onlyOwner() {
        require(msg.sender == owner, "MemeOlympicsEscrow: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "MemeOlympicsEscrow: not relayer");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "MemeOlympicsEscrow: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    /// @param usdcToken USDC contract address on Base Sepolia.
    /// @param relayer_ Backend service wallet allowed to call setWinners.
    constructor(address usdcToken, address relayer_) {
        require(usdcToken != address(0), "MemeOlympicsEscrow: zero usdc");
        require(relayer_ != address(0), "MemeOlympicsEscrow: zero relayer");
        usdc = IERC20(usdcToken);
        owner = msg.sender;
        relayer = relayer_;
    }

    // ------------------------------------------------------------------
    // Funding — anyone can deposit USDC into a competition's pool. Caller
    // must have approved this contract for `amount` beforehand.
    // ------------------------------------------------------------------
    function fundCompetition(bytes32 competitionId, uint256 amount) external nonReentrant {
        require(amount > 0, "MemeOlympicsEscrow: amount must be > 0");
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "MemeOlympicsEscrow: USDC transferFrom failed");
        pools[competitionId].deposited += amount;
        emit Deposited(competitionId, msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Relayer — pushes the GenLayer-finalized winners list exactly once per
    // competition. Amounts are only credited as claimable, never pushed
    // directly to winners, so this never has to trust an arbitrary external
    // call succeeding for N winners in one transaction.
    // ------------------------------------------------------------------
    function setWinners(
        bytes32 competitionId,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyRelayer {
        require(winners.length == amounts.length, "MemeOlympicsEscrow: length mismatch");
        require(winners.length > 0, "MemeOlympicsEscrow: no winners");

        Pool storage pool = pools[competitionId];
        require(!pool.winnersSet, "MemeOlympicsEscrow: winners already set");

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(winners[i] != address(0), "MemeOlympicsEscrow: zero winner address");
            total += amounts[i];
        }
        require(
            total <= pool.deposited - pool.allocated,
            "MemeOlympicsEscrow: total exceeds undeposited/unallocated pool"
        );

        pool.winnersSet = true;
        pool.allocated += total;

        for (uint256 i = 0; i < winners.length; i++) {
            if (amounts[i] == 0) continue;
            claimable[competitionId][winners[i]] += amounts[i];
            totalClaimable[winners[i]] += amounts[i];
        }

        emit WinnersSet(competitionId, winners.length, total);
    }

    // ------------------------------------------------------------------
    // Claims — self-serve pull pattern, checks-effects-interactions.
    // ------------------------------------------------------------------
    function claim(bytes32 competitionId) external nonReentrant {
        uint256 amount = claimable[competitionId][msg.sender];
        require(amount > 0, "MemeOlympicsEscrow: nothing claimable");

        claimable[competitionId][msg.sender] = 0;
        totalClaimable[msg.sender] -= amount;

        bool ok = usdc.transfer(msg.sender, amount);
        require(ok, "MemeOlympicsEscrow: USDC transfer failed");

        emit Claimed(competitionId, msg.sender, amount);
    }

    /// @notice Claim across several competitions in one transaction.
    function claimMany(bytes32[] calldata competitionIds) external nonReentrant {
        uint256 total = 0;
        for (uint256 i = 0; i < competitionIds.length; i++) {
            bytes32 id = competitionIds[i];
            uint256 amount = claimable[id][msg.sender];
            if (amount == 0) continue;
            claimable[id][msg.sender] = 0;
            total += amount;
            emit Claimed(id, msg.sender, amount);
        }
        require(total > 0, "MemeOlympicsEscrow: nothing claimable");
        totalClaimable[msg.sender] -= total;
        bool ok = usdc.transfer(msg.sender, total);
        require(ok, "MemeOlympicsEscrow: USDC transfer failed");
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "MemeOlympicsEscrow: zero relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MemeOlympicsEscrow: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    /// @notice Owner can pull back USDC that was deposited under a
    ///         competition but never allocated to winners (e.g. a cancelled
    ///         arena, or leftover dust below the reward-share integer
    ///         rounding). Cannot touch anything already allocated/claimable.
    function withdrawUnallocated(bytes32 competitionId, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "MemeOlympicsEscrow: zero recipient");
        Pool storage pool = pools[competitionId];
        uint256 available = pool.deposited - pool.allocated;
        require(amount <= available, "MemeOlympicsEscrow: exceeds unallocated amount");
        pool.deposited -= amount;
        bool ok = usdc.transfer(to, amount);
        require(ok, "MemeOlympicsEscrow: USDC transfer failed");
        emit UnallocatedWithdrawn(competitionId, to, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function getPool(bytes32 competitionId) external view returns (uint256 deposited, uint256 allocated, bool winnersSet) {
        Pool storage pool = pools[competitionId];
        return (pool.deposited, pool.allocated, pool.winnersSet);
    }

    function getClaimable(bytes32 competitionId, address winner) external view returns (uint256) {
        return claimable[competitionId][winner];
    }
}
