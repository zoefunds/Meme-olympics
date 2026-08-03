/** ABI subset for MemeOlympicsEscrow.sol (contracts/base/MemeOlympicsEscrow.sol),
 * deployed on Base Sepolia. Kept hand-written and minimal — only the
 * functions/events the backend actually calls. */
export const MEME_OLYMPICS_ESCROW_ABI = [
  "function fundCompetition(bytes32 competitionId, uint256 amount) external",
  "function setWinners(bytes32 competitionId, address[] winners, uint256[] amounts) external",
  "function claim(bytes32 competitionId) external",
  "function claimMany(bytes32[] competitionIds) external",
  "function getPool(bytes32 competitionId) external view returns (uint256 deposited, uint256 allocated, bool winnersSet)",
  "function getClaimable(bytes32 competitionId, address winner) external view returns (uint256)",
  "function relayer() external view returns (address)",
  "function owner() external view returns (address)",
  "event WinnersSet(bytes32 indexed competitionId, uint256 winnerCount, uint256 totalAllocated)",
  "event Claimed(bytes32 indexed competitionId, address indexed winner, uint256 amount)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
] as const;
