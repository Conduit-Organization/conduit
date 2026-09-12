import { createContext, useContext } from 'react';

/**
 * The ticker this engine settles in, available anywhere in the tree.
 *
 * The app hardcoded "USD₮" in a dozen leaf components, which silently became wrong when
 * settlement moved to Arc — where the asset is USDC. Several of those leaves (a chat
 * receipt, the wallet gate, the seller dashboard) never receive `state`, so threading a
 * prop through every intermediate component just to relabel a currency would add noise to
 * files that have nothing to do with networks.
 *
 * The default is USDC because that is the default network's asset; the provider overrides
 * it from `state.network.symbol` as soon as the engine reports in.
 */
const SymbolContext = createContext<string>('USDC');

export function SymbolProvider({ value, children }: { value: string | undefined; children: React.ReactNode }) {
  return <SymbolContext.Provider value={value ?? 'USDC'}>{children}</SymbolContext.Provider>;
}

/** The settlement ticker to show next to an amount. */
export function useSymbol(): string {
  return useContext(SymbolContext);
}
