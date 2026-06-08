import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

const USDT = 1_000_000n; // 1 USD₮ at 6 decimals
const PRICE = 10_000n; // 0.01 USD₮ per inference
const DAY = 24 * 60 * 60;

async function deploy() {
  const [deployer, buyer, seller, other] = await ethers.getSigners();
  const usdt = await (await ethers.getContractFactory('MockUSDT')).deploy();
  const escrow = await (await ethers.getContractFactory('ConduitEscrow')).deploy(await usdt.getAddress());
  await usdt.mint(buyer.address, 100n * USDT);
  await usdt.connect(buyer).approve(await escrow.getAddress(), 100n * USDT);
  return { deployer, buyer, seller, other, usdt, escrow };
}

// Sign an EIP-712 voucher with `signer`, for a voucher whose `buyer` field is `buyerAddr`.
async function sign(escrow: any, signer: Signer, buyerAddr: string, sellerAddr: string, epoch: number, cumulative: bigint) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: 'ConduitEscrow', version: '1', chainId: net.chainId, verifyingContract: await escrow.getAddress() };
  const types = {
    Voucher: [
      { name: 'buyer', type: 'address' },
      { name: 'seller', type: 'address' },
      { name: 'epoch', type: 'uint64' },
      { name: 'cumulativeAmount', type: 'uint256' },
    ],
  };
  const value = { buyer: buyerAddr, seller: sellerAddr, epoch, cumulativeAmount: cumulative };
  return (signer as any).signTypedData(domain, types, value);
}

describe('ConduitEscrow', () => {
  it('opens a channel and pulls the deposit', async () => {
    const { buyer, seller, usdt, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const c = await escrow.channels(buyer.address, seller.address);
    expect(c.deposit).to.equal(USDT);
    expect(c.open).to.equal(true);
    expect(c.epoch).to.equal(1n);
    expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(USDT);
  });

  it('cannot open a second channel to the same seller while open', async () => {
    const { buyer, seller, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    await expect(escrow.connect(buyer).open(seller.address, USDT, DAY)).to.be.revertedWith('already open');
  });

  it('lets the seller claim cumulative vouchers (instant draws settled on-chain)', async () => {
    const { buyer, seller, usdt, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    await escrow.connect(seller).claim(buyer.address, PRICE, await sign(escrow, buyer, buyer.address, seller.address, 1, PRICE));
    expect(await usdt.balanceOf(seller.address)).to.equal(PRICE);
    await escrow.connect(seller).claim(buyer.address, 3n * PRICE, await sign(escrow, buyer, buyer.address, seller.address, 1, 3n * PRICE));
    expect(await usdt.balanceOf(seller.address)).to.equal(3n * PRICE); // paid the delta only
    expect((await escrow.channels(buyer.address, seller.address)).claimed).to.equal(3n * PRICE);
  });

  it('rejects a claim above the deposit', async () => {
    const { buyer, seller, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const sig = await sign(escrow, buyer, buyer.address, seller.address, 1, 2n * USDT);
    await expect(escrow.connect(seller).claim(buyer.address, 2n * USDT, sig)).to.be.revertedWith('exceeds deposit');
  });

  it('rejects a re-claim of the same cumulative (monotonic)', async () => {
    const { buyer, seller, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const sig = await sign(escrow, buyer, buyer.address, seller.address, 1, PRICE);
    await escrow.connect(seller).claim(buyer.address, PRICE, sig);
    await expect(escrow.connect(seller).claim(buyer.address, PRICE, sig)).to.be.revertedWith('nothing to claim');
  });

  it('rejects a voucher not signed by the buyer', async () => {
    const { buyer, seller, other, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    // voucher's buyer field is the real buyer, but it's signed by `other`
    const forged = await sign(escrow, other, buyer.address, seller.address, 1, PRICE);
    await expect(escrow.connect(seller).claim(buyer.address, PRICE, forged)).to.be.revertedWith('bad voucher');
  });

  it('rejects a voucher claimed by the wrong seller', async () => {
    const { buyer, seller, other, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const sig = await sign(escrow, buyer, buyer.address, seller.address, 1, PRICE);
    // `other` (a different seller) has no channel from buyer
    await expect(escrow.connect(other).claim(buyer.address, PRICE, sig)).to.be.revertedWith('no channel');
  });

  it('rejects an old-epoch voucher after the channel is reopened (replay protection)', async () => {
    const { buyer, seller, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const epoch1Sig = await sign(escrow, buyer, buyer.address, seller.address, 1, 5n * PRICE);
    // settle + close epoch 1
    await escrow.connect(seller).settle(buyer.address, 5n * PRICE, epoch1Sig);
    // reopen → epoch 2
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    expect((await escrow.channels(buyer.address, seller.address)).epoch).to.equal(2n);
    // the epoch-1 voucher must not work against epoch 2
    await expect(escrow.connect(seller).claim(buyer.address, 5n * PRICE, epoch1Sig)).to.be.revertedWith('bad voucher');
  });

  it('settles: seller paid, buyer refunded the remainder, channel closed', async () => {
    const { buyer, seller, usdt, escrow } = await deploy();
    const before = await usdt.balanceOf(buyer.address);
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    const sig = await sign(escrow, buyer, buyer.address, seller.address, 1, 7n * PRICE);
    await escrow.connect(seller).settle(buyer.address, 7n * PRICE, sig);
    expect(await usdt.balanceOf(seller.address)).to.equal(7n * PRICE);
    // buyer paid USDT in, got back USDT - 7*PRICE
    expect(await usdt.balanceOf(buyer.address)).to.equal(before - 7n * PRICE);
    expect((await escrow.channels(buyer.address, seller.address)).open).to.equal(false);
  });

  it('blocks buyer withdraw before expiry, allows it after, refunding the remainder', async () => {
    const { buyer, seller, usdt, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    await escrow.connect(seller).claim(buyer.address, 4n * PRICE, await sign(escrow, buyer, buyer.address, seller.address, 1, 4n * PRICE));
    await expect(escrow.connect(buyer).withdraw(seller.address)).to.be.revertedWith('before expiry');
    await ethers.provider.send('evm_increaseTime', [DAY + 1]);
    await ethers.provider.send('evm_mine', []);
    const before = await usdt.balanceOf(buyer.address);
    await escrow.connect(buyer).withdraw(seller.address);
    expect(await usdt.balanceOf(buyer.address)).to.equal(before + (USDT - 4n * PRICE)); // remainder back
    expect((await escrow.channels(buyer.address, seller.address)).open).to.equal(false);
  });

  it('topUp increases the deposit', async () => {
    const { buyer, seller, escrow } = await deploy();
    await escrow.connect(buyer).open(seller.address, USDT, DAY);
    await escrow.connect(buyer).topUp(seller.address, USDT);
    expect((await escrow.channels(buyer.address, seller.address)).deposit).to.equal(2n * USDT);
  });
});
