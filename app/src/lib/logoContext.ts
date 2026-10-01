import { createContext, useContext } from 'react';

/** Свои логотипы с листа «Логотипы» — доступны любому компоненту без протаскивания через props. */
export const LogosContext = createContext<[string, string][]>([]);
export const useLogos = () => useContext(LogosContext);
