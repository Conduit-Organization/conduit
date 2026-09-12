import { createContext, useContext } from 'react';

/**
 * Facts about the network this engine settles on, available anywhere in the tree.
 *
 * The app hardcoded "USD₮" in a dozen leaf components and told every seller that buyers
 * pay them "on Sepolia". Both silently became wrong when settlement moved to Arc, where
 * the asset is USDC. Several of the places that show an amount — a chat receipt, the
 * wallet gate, the seller dashboard — never receive engine state, so threading props
 * through the tree purely to relabel a currency would put network concerns in files that
 * have none.
 *
 * The defaults describe the default network; the provider overrides them from
 * `state.network` as soon as the engine reports in.
 */
const SymbolContext = createContext<string>('USDC');
const NetworkLabelContext = createContext<string>('this network');

export function SymbolProvider({
  value,
  network,
  children,
}: {
  value: string | undefined;
  network?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <SymbolContext.Provider value={value ?? 'USDC'}>
      <NetworkLabelContext.Provider value={network ?? 'this network'}>{children}</NetworkLabelContext.Provider>
    </SymbolContext.Provider>
  );
}

/** The settlement ticker to show next to an amount. */
export function useSymbol(): string {
  return useContext(SymbolContext);
}

/** The human name of the settlement network ("Arc Testnet"). */
export function useNetworkLabel(): string {
  return useContext(NetworkLabelContext);
}
