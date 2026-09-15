import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useDataChanged } from '../hooks/useDataChanged';
import { formatCompact, formatMoney } from './format';

const SettingsContext = createContext(null);

const DEFAULTS = { business_name: 'DocDesk', currency_symbol: '', default_tax_rate: '0' };

/**
 * The shop's details, loaded once and shared: the name in the top bar, the
 * currency symbol on every amount, the tax rate on new sales. Re-read whenever
 * something (a form or the assistant) changes settings.
 */
export function SettingsProvider({ children }) {
  const [values, setValues] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api.settings.get();
      setValues({ ...DEFAULTS, ...data.values });
    } catch {
      // The server being down is reported by the page itself; keep defaults.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useDataChanged(() => reload(), ['settings']);

  const value = useMemo(() => {
    const symbol = values.currency_symbol || '';
    return {
      values,
      loaded,
      reload,
      businessName: values.business_name || 'DocDesk',
      currency: symbol,
      money: (amount) => formatMoney(amount, symbol),
      compactMoney: (amount) => formatCompact(amount, symbol),
    };
  }, [values, loaded, reload]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside SettingsProvider');
  return context;
}
