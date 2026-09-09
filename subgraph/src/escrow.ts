// ConduitEscrow event handlers — ETHOnline 2026 (new work).
//
// Builds a per-seller settlement record that a buyer's client reads BEFORE choosing who
// to buy from. The whole point of this file is what it refuses to count: a `Withdrawn`
// event is not evidence of seller misconduct, and treating it as such is the trap this
// mapping exists to avoid. See src/core/qualification.ts for the reasoning and
// contracts/test/sybil-grief.test.ts for the proof.
import { BigInt, Bytes, Address, ethereum } from '@graphprotocol/graph-ts';
import {
  ChannelOpened,
  ToppedUp,
  Claimed,
  Settled,
  Withdrawn,
} from '../generated/ConduitEscrow/ConduitEscrow';
import { Seller, Buyer, Channel, Market, Pair } from '../generated/schema';
import {
  disqualificationReasons,
  isRenewalGap,
  REASON_IS_RENEWAL,
} from './qualification';

const MARKET_ID = 'market';
const ONE = BigInt.fromI32(1);

// ─────────────────────────── entity helpers ───────────────────────────

function loadMarket(event: ethereum.Event): Market {
  let m = Market.load(MARKET_ID);
  if (m == null) {
    m = new Market(MARKET_ID);
    m.totalChannelsOpened = BigInt.zero();
    m.totalSettled = BigInt.zero();
    m.totalWithdrawn = BigInt.zero();
    m.totalQualifiedWithdrawn = BigInt.zero();
    m.totalProbeChannels = BigInt.zero();
    m.totalRenewals = BigInt.zero();
    m.totalClaimed = BigInt.zero();
    m.sellerCount = BigInt.zero();
    m.buyerCount = BigInt.zero();
  }
  m.lastUpdatedBlock = event.block.number;
  return m as Market;
}

function loadSeller(addr: Address, event: ethereum.Event, market: Market): Seller {
  let s = Seller.load(addr);
  if (s == null) {
    s = new Seller(addr);
    s.channelsOpened = BigInt.zero();
    s.channelsSettled = BigInt.zero();
    s.qualifiedWithdrawn = BigInt.zero();
    s.probeChannels = BigInt.zero();
    s.renewals = BigInt.zero();
    s.withdrawnTotal = BigInt.zero();
    s.totalClaimed = BigInt.zero();
    s.totalRefunded = BigInt.zero();
    s.uniqueBuyers = BigInt.zero();
    s.firstSeen = event.block.timestamp;
    market.sellerCount = market.sellerCount.plus(ONE);
  }
  return s as Seller;
}

function loadBuyer(addr: Address, event: ethereum.Event, market: Market): Buyer {
  let b = Buyer.load(addr);
  if (b == null) {
    b = new Buyer(addr);
    b.channelsOpened = BigInt.zero();
    b.channelsSettled = BigInt.zero();
    b.channelsWithdrawn = BigInt.zero();
    b.channelsAbandoned = BigInt.zero();
    b.totalDeposited = BigInt.zero();
    b.firstSeen = event.block.timestamp;
    market.buyerCount = market.buyerCount.plus(ONE);
  }
  return b as Buyer;
}

function pairId(buyer: Address, seller: Address): string {
  return buyer.toHexString() + '-' + seller.toHexString();
}

function channelId(buyer: Address, seller: Address, epoch: BigInt): string {
  return buyer.toHexString() + '-' + seller.toHexString() + '-' + epoch.toString();
}

/**
 * `Settled` and `Withdrawn` carry no epoch, but they always close the pair's CURRENT
 * channel, and `open()` only ever increments the epoch. So the pair's latest epoch
 * identifies the channel the event refers to.
 */
function currentChannel(buyer: Address, seller: Address): Channel | null {
  const p = Pair.load(pairId(buyer, seller));
  if (p == null) return null;
  return Channel.load(channelId(buyer, seller, p.latestEpoch));
}

// ─────────────────────────── handlers ───────────────────────────

export function handleChannelOpened(event: ChannelOpened): void {
  const market = loadMarket(event);
  const seller = loadSeller(event.params.seller, event, market);
  const buyer = loadBuyer(event.params.buyer, event, market);
  const epoch = event.params.epoch;
  const openedAt = event.block.timestamp;

  // epoch is per (buyer, seller) and starts at 1, so epoch == 1 means these two have
  // never traded before — that is exactly "a new distinct buyer for this seller".
  if (epoch.equals(ONE)) {
    seller.uniqueBuyers = seller.uniqueBuyers.plus(ONE);
  }

  // ── Renewal reclassification ──
  // The previous channel for this pair is deterministically epoch-1. If it was
  // withdrawn moments ago, this open is the same buyer coming straight back: a session
  // renewal, not an abandonment. Both of ConduitEscrow's real Withdrawn events on
  // Sepolia are this shape, 24 seconds apart.
  if (epoch.gt(ONE)) {
    const prev = Channel.load(channelId(event.params.buyer, event.params.seller, epoch.minus(ONE)));
    if (prev != null && prev.status == 'WITHDRAWN' && prev.closedAt !== null) {
      const gap = openedAt.minus(prev.closedAt as BigInt);
      if (isRenewalGap(gap)) {
        // Undo whichever bucket the withdrawal was counted in...
        if (prev.qualifiedOnChain == true) {
          seller.qualifiedWithdrawn = seller.qualifiedWithdrawn.minus(ONE);
          market.totalQualifiedWithdrawn = market.totalQualifiedWithdrawn.minus(ONE);
          // It was counted against the buyer as an abandonment too. It was not one.
          buyer.channelsAbandoned = buyer.channelsAbandoned.minus(ONE);
        } else {
          seller.probeChannels = seller.probeChannels.minus(ONE);
          market.totalProbeChannels = market.totalProbeChannels.minus(ONE);
        }
        // ...and record it for what it actually was.
        seller.renewals = seller.renewals.plus(ONE);
        market.totalRenewals = market.totalRenewals.plus(ONE);

        prev.status = 'RENEWED';
        prev.qualifiedOnChain = false;
        prev.secondsUntilBuyerReopened = gap;
        const reasons = prev.disqualificationReasons;
        reasons.push(REASON_IS_RENEWAL);
        prev.disqualificationReasons = reasons;
        prev.save();
      }
    }
  }

  const channel = new Channel(channelId(event.params.buyer, event.params.seller, epoch));
  channel.buyer = buyer.id;
  channel.seller = seller.id;
  channel.epoch = epoch;
  channel.deposit = event.params.amount;
  channel.claimed = BigInt.zero();
  channel.refunded = BigInt.zero();
  channel.expiry = event.params.expiry;
  // The griefing PoC makes this 1. A real session is >= 600.
  channel.durationSecs = channel.expiry.minus(openedAt);
  channel.status = 'OPEN';
  channel.openedAt = openedAt;
  channel.openTx = event.transaction.hash;
  channel.disqualificationReasons = [];
  channel.save();

  let pair = Pair.load(pairId(event.params.buyer, event.params.seller));
  if (pair == null) {
    pair = new Pair(pairId(event.params.buyer, event.params.seller));
    pair.buyer = buyer.id;
    pair.seller = seller.id;
    pair.channelCount = BigInt.zero();
  }
  pair.latestEpoch = epoch;
  pair.channelCount = pair.channelCount.plus(ONE);
  pair.save();

  seller.channelsOpened = seller.channelsOpened.plus(ONE);
  buyer.channelsOpened = buyer.channelsOpened.plus(ONE);
  buyer.totalDeposited = buyer.totalDeposited.plus(event.params.amount);
  market.totalChannelsOpened = market.totalChannelsOpened.plus(ONE);

  seller.save();
  buyer.save();
  market.save();
}

export function handleToppedUp(event: ToppedUp): void {
  const channel = currentChannel(event.params.buyer, event.params.seller);
  if (channel == null) return;
  // `deposit` in the event is the new running total, so take it rather than adding.
  channel.deposit = event.params.deposit;
  channel.save();

  const market = loadMarket(event);
  const buyer = loadBuyer(event.params.buyer, event, market);
  buyer.totalDeposited = buyer.totalDeposited.plus(event.params.amount);
  buyer.save();
  market.save();
}

export function handleClaimed(event: Claimed): void {
  const market = loadMarket(event);
  const seller = loadSeller(event.params.seller, event, market);

  seller.totalClaimed = seller.totalClaimed.plus(event.params.paid);
  market.totalClaimed = market.totalClaimed.plus(event.params.paid);

  const channel = currentChannel(event.params.buyer, event.params.seller);
  if (channel != null) {
    channel.claimed = event.params.cumulativeAmount;
    channel.save();
  }

  seller.save();
  market.save();
}

export function handleSettled(event: Settled): void {
  const market = loadMarket(event);
  const seller = loadSeller(event.params.seller, event, market);
  const buyer = loadBuyer(event.params.buyer, event, market);

  seller.channelsSettled = seller.channelsSettled.plus(ONE);
  seller.totalClaimed = seller.totalClaimed.plus(event.params.toSeller);
  seller.totalRefunded = seller.totalRefunded.plus(event.params.toBuyer);
  seller.lastSettled = event.block.timestamp;

  buyer.channelsSettled = buyer.channelsSettled.plus(ONE);

  market.totalSettled = market.totalSettled.plus(ONE);
  market.totalClaimed = market.totalClaimed.plus(event.params.toSeller);

  const channel = currentChannel(event.params.buyer, event.params.seller);
  if (channel != null) {
    channel.status = 'SETTLED';
    channel.refunded = event.params.toBuyer;
    channel.closedAt = event.block.timestamp;
    channel.closeTx = event.transaction.hash;
    // A settled channel is not an adverse signal at all — the rules never apply.
    channel.qualifiedOnChain = false;
    channel.save();
  }

  seller.save();
  buyer.save();
  market.save();
}

export function handleWithdrawn(event: Withdrawn): void {
  const market = loadMarket(event);
  const seller = loadSeller(event.params.seller, event, market);
  const buyer = loadBuyer(event.params.buyer, event, market);

  seller.withdrawnTotal = seller.withdrawnTotal.plus(ONE);
  buyer.channelsWithdrawn = buyer.channelsWithdrawn.plus(ONE);
  market.totalWithdrawn = market.totalWithdrawn.plus(ONE);

  const channel = currentChannel(event.params.buyer, event.params.seller);
  if (channel != null) {
    channel.status = 'WITHDRAWN';
    channel.refunded = event.params.refund;
    channel.closedAt = event.block.timestamp;
    channel.closeTx = event.transaction.hash;

    // The buyer's settlement count EXCLUDING this channel — this one did not settle.
    const reasons = disqualificationReasons(channel.durationSecs, channel.deposit, buyer.channelsSettled);
    const qualified = reasons.length == 0;
    channel.disqualificationReasons = reasons;
    channel.qualifiedOnChain = qualified;
    channel.save();

    if (qualified) {
      // A real adverse signal — provisionally. handleChannelOpened may still reclassify
      // it as a renewal if this same buyer reopens within the window.
      seller.qualifiedWithdrawn = seller.qualifiedWithdrawn.plus(ONE);
      market.totalQualifiedWithdrawn = market.totalQualifiedWithdrawn.plus(ONE);
      buyer.channelsAbandoned = buyer.channelsAbandoned.plus(ONE);
    } else {
      // Indexed and visible, but not scoring. Never silently dropped.
      seller.probeChannels = seller.probeChannels.plus(ONE);
      market.totalProbeChannels = market.totalProbeChannels.plus(ONE);
    }
  }

  seller.save();
  buyer.save();
  market.save();
}
