// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ConduitEscrow — unidirectional USD₮ payment channels for Conduit.
/// @notice A buyer opens a channel by locking a deposit. Per inference the buyer signs an off-chain
/// EIP-712 voucher authorizing a CUMULATIVE amount; the seller redeems vouchers on-chain via
/// `claim` (channel stays open) or `settle` (final claim + close, refunding the rest to the buyer).
/// The buyer can always reclaim the unspent remainder after `expiry` (`withdraw`), so a vanished
/// seller can never lock funds. Trustless: the contract only ever pays the seller what the buyer
/// signed, and never more than the deposit.
contract ConduitEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // settlement token (test-USD₮ on Sepolia)

    struct Channel {
        uint256 deposit; // total locked by the buyer
        uint256 claimed; // total already paid out to the seller
        uint64 expiry;   // buyer may withdraw the remainder at/after this time
        uint64 epoch;    // increments on each (re)open; scopes vouchers against cross-channel replay
        bool open;
    }

    // channels[buyer][seller]
    mapping(address => mapping(address => Channel)) public channels;

    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address buyer,address seller,uint64 epoch,uint256 cumulativeAmount)");

    event ChannelOpened(address indexed buyer, address indexed seller, uint256 amount, uint64 expiry, uint64 epoch);
    event ToppedUp(address indexed buyer, address indexed seller, uint256 amount, uint256 deposit);
    event Claimed(address indexed buyer, address indexed seller, uint256 cumulativeAmount, uint256 paid);
    event Settled(address indexed buyer, address indexed seller, uint256 toSeller, uint256 toBuyer);
    event Withdrawn(address indexed buyer, address indexed seller, uint256 refund);

    constructor(IERC20 _token) EIP712("ConduitEscrow", "1") {
        require(address(_token) != address(0), "token=0");
        token = _token;
    }

    /// @notice Open a channel to `seller`, locking `amount` for `duration` seconds. Requires prior approve().
    function open(address seller, uint256 amount, uint64 duration) external nonReentrant {
        require(seller != address(0), "seller=0");
        require(amount > 0, "amount=0");
        require(duration > 0, "duration=0");
        Channel storage c = channels[msg.sender][seller];
        require(!c.open, "already open");
        c.deposit = amount;
        c.claimed = 0;
        c.expiry = uint64(block.timestamp) + duration;
        c.epoch += 1; // persists across re-opens → old-epoch vouchers can't be replayed
        c.open = true;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ChannelOpened(msg.sender, seller, amount, c.expiry, c.epoch);
    }

    /// @notice Add more funds to an open channel.
    function topUp(address seller, uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        Channel storage c = channels[msg.sender][seller];
        require(c.open, "no channel");
        c.deposit += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ToppedUp(msg.sender, seller, amount, c.deposit);
    }

    /// @notice Seller redeems earnings up to `cumulativeAmount` (channel stays open for more draws).
    function claim(address buyer, uint256 cumulativeAmount, bytes calldata signature) external nonReentrant {
        Channel storage c = channels[buyer][msg.sender];
        require(c.open, "no channel");
        require(cumulativeAmount <= c.deposit, "exceeds deposit");
        require(cumulativeAmount > c.claimed, "nothing to claim");
        require(_voucherSigner(buyer, msg.sender, c.epoch, cumulativeAmount, signature) == buyer, "bad voucher");
        uint256 paid = cumulativeAmount - c.claimed;
        c.claimed = cumulativeAmount; // effects before interaction (CEI)
        token.safeTransfer(msg.sender, paid);
        emit Claimed(buyer, msg.sender, cumulativeAmount, paid);
    }

    /// @notice Seller settles at `cumulativeAmount` and closes the channel, refunding the rest to the buyer.
    function settle(address buyer, uint256 cumulativeAmount, bytes calldata signature) external nonReentrant {
        Channel storage c = channels[buyer][msg.sender];
        require(c.open, "no channel");
        require(cumulativeAmount >= c.claimed, "below claimed");
        require(cumulativeAmount <= c.deposit, "exceeds deposit");
        require(_voucherSigner(buyer, msg.sender, c.epoch, cumulativeAmount, signature) == buyer, "bad voucher");
        uint256 toSeller = cumulativeAmount - c.claimed;
        uint256 toBuyer = c.deposit - cumulativeAmount;
        c.open = false; // effects before interactions (CEI)
        c.deposit = 0;
        c.claimed = 0;
        if (toSeller > 0) token.safeTransfer(msg.sender, toSeller);
        if (toBuyer > 0) token.safeTransfer(buyer, toBuyer);
        emit Settled(buyer, msg.sender, toSeller, toBuyer);
    }

    /// @notice Buyer reclaims the unspent remainder after expiry (protects against a vanished seller).
    function withdraw(address seller) external nonReentrant {
        Channel storage c = channels[msg.sender][seller];
        require(c.open, "no channel");
        require(block.timestamp >= c.expiry, "before expiry");
        uint256 refund = c.deposit - c.claimed;
        c.open = false; // effects before interaction (CEI)
        c.deposit = 0;
        c.claimed = 0;
        if (refund > 0) token.safeTransfer(msg.sender, refund);
        emit Withdrawn(msg.sender, seller, refund);
    }

    /// @notice The EIP-712 digest a buyer signs for a voucher (exposed so off-chain code can match it).
    function voucherDigest(address buyer, address seller, uint64 epoch, uint256 cumulativeAmount)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, buyer, seller, epoch, cumulativeAmount)));
    }

    function _voucherSigner(
        address buyer,
        address seller,
        uint64 epoch,
        uint256 cumulativeAmount,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, buyer, seller, epoch, cumulativeAmount)));
        return ECDSA.recover(digest, signature);
    }
}
