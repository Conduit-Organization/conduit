// WDK EVM wallet wrapper. Conduit wallets are WDK mnemonic (BIP-39) wallets — WDK requires a
// seed phrase, not a raw private key. One mnemonic derives many accounts by index
// (`getAccount(i)`), so a single dev seed gives us both a "buyer" (index 0) and "seller" (index 1).
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';

export interface ConduitAccount {
  address: string;
  /** native ETH balance (wei) */
  ethBalance(): Promise<bigint>;
  /** ERC-20 token balance (base units) */
  tokenBalance(token: string): Promise<bigint>;
  /** transfer an ERC-20 token; returns a TransferResult ({ hash, ... }) */
  transferToken(token: string, recipient: string, amount: bigint): Promise<{ hash: string } & Record<string, unknown>>;
  getReceipt(hash: string): Promise<unknown>;
  /** the underlying WDK account (escape hatch) */
  raw: any;
}

/** Derive a Conduit account from a mnemonic at the given index (0 = first account). */
export async function getAccount(mnemonic: string, rpcUrl: string, index = 0): Promise<ConduitAccount> {
  const Manager: any = WalletManagerEvm;
  const manager = new Manager(mnemonic, { provider: rpcUrl });
  const account: any = await manager.getAccount(index);
  const address: string = await account.getAddress();
  return {
    address,
    raw: account,
    ethBalance: () => account.getBalance(),
    tokenBalance: (token: string) => account.getTokenBalance(token),
    transferToken: (token: string, recipient: string, amount: bigint) =>
      account.transfer({ token, recipient, amount }),
    getReceipt: (hash: string) => account.getTransactionReceipt(hash),
  };
}
