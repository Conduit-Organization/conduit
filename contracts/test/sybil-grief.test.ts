// Sybil-griefing PoC — ETHOnline 2026 (new work).
//
// This suite does NOT report a bug in ConduitEscrow. The contract behaves exactly as
// documented: funds are safe, and a buyer's right to reclaim an unspent deposit after
// expiry is the whole point of `withdraw`.
//
// What it proves is that `Withdrawn` — the event our new global-reputation work was
// about to treat as "the on-chain fingerprint of a seller who took a channel and did
// not deliver" — is FORGEABLE FOR GAS by a stranger who never intended to buy
// anything. `open()` validates only `amount > 0` and `duration > 0`, so a channel can
// be opened and withdrawn in consecutive blocks with the deposit returned in full.
//
// The victim is not consulted, does not act, and need not even be a seller.
//
// Read with `contracts/test/qualified-signal.test.ts`, which proves the hardened
// qualification rules reject every channel manufactured here.
import { expect } from 'chai';
import { ethers } from 'hardhat';

const USDT = 1_000_000n; // 1 USD₮ at 6 decimals
const HOUR = 60 * 60;

// The minimum the contract will accept: `require(amount > 0)`. One base unit is
// 0.000001 USD₮ — a millionth of a dollar, and it comes straight back.
const DUST = 1n;

async function deploy() {
  const [deployer, victimSeller, honestBuyer] = await ethers.getSigners();
  const usdt = await (await ethers.getContractFactory('MockUSDT')).deploy();
  const escrow = await (await ethers.getContractFactory('ConduitEscrow')).deploy(await usdt.getAddress());
  return { deployer, victimSeller, honestBuyer, usdt, escrow };
}

describe('Sybil-griefing of the Withdrawn signal (PoC)', () => {
  it('accepts duration = 1, so a channel expires in the very next block', async () => {
    const { deployer, victimSeller, usdt, escrow } = await deploy();
    await usdt.mint(deployer.address, USDT);
    await usdt.approve(await escrow.getAddress(), USDT);

    // `require(duration > 0, "duration=0")` is the only bound. 1 second is legal.
    await escrow.open(victimSeller.address, DUST, 1);

    const c = await escrow.channels(deployer.address, victimSeller.address);
    const openedAt = BigInt((await ethers.provider.getBlock('latest'))!.timestamp);
    expect(c.expiry).to.equal(openedAt + 1n);

    // withdraw() requires block.timestamp >= expiry. One block later, that holds.
    await expect(escrow.withdraw(victimSeller.address)).to.not.be.reverted;
  });

  it('forges a Withdrawn event against a seller who did nothing, and returns the deposit in full', async () => {
    const { deployer, victimSeller, usdt, escrow } = await deploy();
    await usdt.mint(deployer.address, USDT);
    await usdt.approve(await escrow.getAddress(), USDT);

    const before = await usdt.balanceOf(deployer.address);

    await escrow.open(victimSeller.address, DUST, 1);
    await expect(escrow.withdraw(victimSeller.address))
      .to.emit(escrow, 'Withdrawn')
      .withArgs(deployer.address, victimSeller.address, DUST);

    // Capital at risk: zero. The deposit came straight back.
    expect(await usdt.balanceOf(deployer.address)).to.equal(before);

    // The victim never transacted and never held the funds.
    expect(await usdt.balanceOf(victimSeller.address)).to.equal(0n);
  });

  it('needs no consent, no relationship and no prior contact with the victim', async () => {
    const { deployer, victimSeller, usdt, escrow } = await deploy();
    await usdt.mint(deployer.address, USDT);
    await usdt.approve(await escrow.getAddress(), USDT);

    // The "seller" here has never opened a channel, never advertised an offer, and
    // never signed anything. Any address at all can be named as the victim.
    const strangerNeverSeenOnChain = ethers.Wallet.createRandom().address;

    await escrow.open(strangerNeverSeenOnChain, DUST, 1);
    await expect(escrow.withdraw(strangerNeverSeenOnChain)).to.emit(escrow, 'Withdrawn');

    expect(victimSeller.address).to.not.equal(strangerNeverSeenOnChain);
  });

  it('five throwaway wallets destroy a naive reliability score for the cost of gas', async () => {
    const { deployer, victimSeller, honestBuyer, usdt, escrow } = await deploy();
    const escrowAddr = await escrow.getAddress();

    // ── One genuine, completed session: the seller actually earned money. ──
    await usdt.mint(honestBuyer.address, 10n * USDT);
    await usdt.connect(honestBuyer).approve(escrowAddr, 10n * USDT);
    await escrow.connect(honestBuyer).open(victimSeller.address, USDT, HOUR);

    const net = await ethers.provider.getNetwork();
    const domain = { name: 'ConduitEscrow', version: '1', chainId: net.chainId, verifyingContract: escrowAddr };
    const types = {
      Voucher: [
        { name: 'buyer', type: 'address' },
        { name: 'seller', type: 'address' },
        { name: 'epoch', type: 'uint64' },
        { name: 'cumulativeAmount', type: 'uint256' },
      ],
    };
    const ch = await escrow.channels(honestBuyer.address, victimSeller.address);
    const sig = await honestBuyer.signTypedData(domain, types, {
      buyer: honestBuyer.address,
      seller: victimSeller.address,
      epoch: ch.epoch,
      cumulativeAmount: USDT / 2n,
    });
    await escrow.connect(victimSeller).settle(honestBuyer.address, USDT / 2n, sig);

    // ── Five strangers grief it. Each funds itself with dust and takes it back. ──
    const ATTACKERS = 5;
    let gasSpent = 0n;

    for (let i = 0; i < ATTACKERS; i++) {
      const throwaway = ethers.Wallet.createRandom().connect(ethers.provider);
      // Gas money + one base unit of token — both trivially small.
      await deployer.sendTransaction({ to: throwaway.address, value: ethers.parseEther('0.05') });
      await usdt.mint(throwaway.address, DUST);

      const a = await (await usdt.connect(throwaway).approve(escrowAddr, DUST)).wait();
      const o = await (await escrow.connect(throwaway).open(victimSeller.address, DUST, 1)).wait();
      const w = await (await escrow.connect(throwaway).withdraw(victimSeller.address)).wait();
      gasSpent += a!.gasUsed + o!.gasUsed + w!.gasUsed;

      // Every base unit came back. The attack costs gas and nothing else.
      expect(await usdt.balanceOf(throwaway.address)).to.equal(DUST);
    }

    // ── Count the events exactly as a naive subgraph mapping would. ──
    const settled = await escrow.queryFilter(escrow.filters.Settled(null, victimSeller.address));
    const withdrawn = await escrow.queryFilter(escrow.filters.Withdrawn(null, victimSeller.address));

    expect(settled.length).to.equal(1);
    expect(withdrawn.length).to.equal(ATTACKERS);

    // reliability = settled / (settled + withdrawn) — the formula we must NOT ship.
    const naiveReliability = settled.length / (settled.length + withdrawn.length);
    expect(naiveReliability).to.be.closeTo(1 / 6, 1e-9);

    // An honest seller, one real completed session, no misconduct — scored at 0.17.
    expect(naiveReliability).to.be.lessThan(0.2);

    console.log(
      `\n      forged ${ATTACKERS} Withdrawn events for ${gasSpent} gas total ` +
        `(${gasSpent / BigInt(ATTACKERS)} per identity), 0 capital at risk`
    );
    console.log(`      naive reliability: ${(naiveReliability * 100).toFixed(1)}% — from 100% before the attack\n`);
  });

  it('the contract itself is not at fault: funds are never at risk', async () => {
    const { deployer, victimSeller, usdt, escrow } = await deploy();
    await usdt.mint(deployer.address, USDT);
    await usdt.approve(await escrow.getAddress(), USDT);

    await escrow.open(victimSeller.address, USDT, 1);
    // The escrow custodies the deposit while the channel is open...
    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(USDT);

    await escrow.withdraw(victimSeller.address);
    // ...and returns every unit. This is `withdraw` doing exactly what it promises:
    // "a vanished seller can never lock funds". The defect is in reading `Withdrawn`
    // as evidence of seller misconduct, not in the contract emitting it.
    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(0n);
  });
});
