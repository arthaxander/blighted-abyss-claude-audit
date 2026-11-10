import { createContext, useContext } from 'react';
export const AccountContext = createContext({ account: null, saveGameState: null, replaceGameState: null, resetGameState: null, getServerNow: () => Date.now(), authoritative: false });
export const useAccount = () => useContext(AccountContext);
