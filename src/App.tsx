import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from './components/Header';
import { ScreenerFilters } from './components/ScreenerFilters';
import { FormationCard } from './components/FormationCard';
import { ScreenerTable } from './components/ScreenerTable';
import { CoinScreenerPage } from './components/CoinScreenerPage';
import { FormationDetailsModal } from './components/FormationDetailsModal';
import { FormationGuideModal } from './components/FormationGuideModal';
import { WatchlistDrawer } from './components/WatchlistDrawer';
import { MetaScalpModal } from './components/MetaScalpModal';
import { MetaScalpToast, MetaScalpToastState } from './components/MetaScalpToast';
import { TelegramAlertsModal } from './components/TelegramAlertsModal';
import { AuthModal } from './components/AuthModal';
import { UserProfileModal } from './components/UserProfileModal';
import { ArchiveModal } from './components/ArchiveModal';
import { AlertToast, AlertToastState } from './components/AlertToast';
import { TerminalPage } from './components/TerminalPage';
import { useAlerts } from './context/AlertsContext';
import { useAuth } from './context/AuthContext';
import { useArchive } from './context/ArchiveContext';
import {
  MetaScalpSettings,
  getStoredMetaScalpSettings,
  saveStoredMetaScalpSettings,
  sendTickerToMetaScalp,
} from './utils/metaScalpService';
import { ScannedCoin, DetectedFormation, ScreenerFilterState, PriceAlert, ArchivedFormation, ActivePageType } from './types';
import {
  AlertCircle,
  RefreshCw,
  Layers,
  Sparkles,
  Lock,
  Key,
  Send,
  ShieldAlert,
  Zap,
  ExternalLink,
  ShieldCheck,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { AUTHOR_TELEGRAM_CHANNEL_URL, AUTHOR_TELEGRAM_USERNAME } from './utils/accessCodes';

const DEFAULT_FILTERS: ScreenerFilterState = {
  exchange: 'binance',
  marketType: 'futures',
  timeframe: '15m',
  category: 'all',
  bias: 'all',
  status: 'all',
  minVolumeUsd: 0,
  searchQuery: '',
  sortBy: 'confidence',
  sortOrder: 'desc',
};

export default function App() {
  const [coins, setCoins] = useState<ScannedCoin[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ScreenerFilterState>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Active Category: 'patterns' (Формації), 'screener' (Скрінер монет), or 'terminal' (Термінал трейдера)
  const [activePage, setActivePage] = useState<ActivePageType>(() => {
    if (typeof window !== 'undefined') {
      if (window.location.hash === '#screener') return 'screener';
      if (window.location.hash === '#terminal') return 'terminal';
    }
    return 'patterns';
  });

  // Listen to hash changes for browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#screener') {
        setActivePage('screener');
      } else if (window.location.hash === '#terminal') {
        setActivePage('terminal');
      } else if (window.location.hash === '#patterns') {
        setActivePage('patterns');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handlePageChange = (page: ActivePageType) => {
    setActivePage(page);
    if (typeof window !== 'undefined') {
      window.location.hash = page;
    }
  };

  // Auth & Profile
  const { user, profile, loading: authLoading, updateProfileData } = useAuth();

  // Watchlist stored per user (isolated)
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistFolders, setWatchlistFolders] = useState<Record<string, string[]>>({});

  // Synchronize watchlist with current logged-in user profile & user-scoped storage
  useEffect(() => {
    if (!user) {
      setWatchlist([]);
      return;
    }

    if (profile?.watchlist && Array.isArray(profile.watchlist)) {
      setWatchlist(Array.from(new Set(profile.watchlist)));
      try {
        localStorage.setItem(`crypto_screener_watchlist_${user.uid}`, JSON.stringify(profile.watchlist));
      } catch {}
      return;
    }

    try {
      const userKey = `crypto_screener_watchlist_${user.uid}`;
      const saved = localStorage.getItem(userKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setWatchlist(Array.from(new Set(parsed)));
          return;
        }
      }
    } catch {}

    setWatchlist([]);
  }, [user?.uid, profile?.watchlist]);

  useEffect(() => {
    if (!user) {
      setWatchlistFolders({});
      return;
    }

    const folders = profile?.watchlistFolders;
    if (folders && typeof folders === 'object') {
      setWatchlistFolders(folders);
      return;
    }

    try {
      const saved = localStorage.getItem(`crypto_screener_watchlist_folders_${user.uid}`);
      setWatchlistFolders(saved ? JSON.parse(saved) : {});
    } catch {
      setWatchlistFolders({});
    }
  }, [user?.uid, profile?.watchlistFolders]);

  // Sound enabled
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('crypto_screener_sound') === 'true';
    } catch {
      return false;
    }
  });

  const [selectedPair, setSelectedPair] = useState<{
    coin: ScannedCoin;
    formation: DetectedFormation;
  } | null>(null);

  const [isWatchlistOpen, setIsWatchlistOpen] = useState<boolean>(false);
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // MetaScalp terminal linking state (isolated per user)
  const [metaScalpSettings, setMetaScalpSettings] = useState<MetaScalpSettings>(() =>
    getStoredMetaScalpSettings(user?.uid)
  );

  useEffect(() => {
    if (!user) return;
    if (profile?.metaScalpSettings) {
      setMetaScalpSettings(profile.metaScalpSettings);
      saveStoredMetaScalpSettings(profile.metaScalpSettings, user.uid);
    } else {
      const userSettings = getStoredMetaScalpSettings(user.uid);
      setMetaScalpSettings(userSettings);
    }
  }, [user?.uid, profile?.metaScalpSettings]);

  const handleMetaScalpSettingsChange = (newSettings: MetaScalpSettings) => {
    setMetaScalpSettings(newSettings);
    if (user) {
      saveStoredMetaScalpSettings(newSettings, user.uid);
      updateProfileData({ metaScalpSettings: newSettings }).catch(() => {});
    }
  };

  const [isMetaScalpModalOpen, setIsMetaScalpModalOpen] = useState<boolean>(false);
  const [metaScalpToast, setMetaScalpToast] = useState<MetaScalpToastState | null>(null);

  // Telegram price alerts state
  const { activeAlertsCount } = useAlerts();
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState<boolean>(false);
  const [telegramPrefill, setTelegramPrefill] = useState<any>(null);
  const [alertToast, setAlertToast] = useState<AlertToastState | null>(null);

  // Formations Archive state
  const { archivedFormations } = useArchive();
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState<boolean>(false);
  const [selectedArchivedItem, setSelectedArchivedItem] = useState<ArchivedFormation | null>(null);

  // Authentication & Profile modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);

  // Auto-dismiss Alert toast
  useEffect(() => {
    if (alertToast) {
      const timer = setTimeout(() => {
        setAlertToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [alertToast]);

  const handleOpenTelegramAlerts = useCallback((prefill?: any) => {
    if (prefill && !user) {
      setIsAuthModalOpen(true);
      setAlertToast({
        id: Date.now(),
        symbol: prefill.symbol || 'ALERT',
        targetPrice: prefill.targetPrice || 0,
        condition: prefill.condition || 'gte',
        message: 'Встановлення сповіщень доступне тільки для зареєстрованих користувачів. Будь ласка, увійдіть або зареєструйтесь.',
      });
      return;
    }
    setTelegramPrefill(prefill || null);
    setIsTelegramModalOpen(true);
  }, [user]);

  const handleAlertToast = useCallback(
    (toast: { symbol: string; targetPrice: number; condition: 'gte' | 'lte'; message?: string }) => {
      setAlertToast({
        id: Date.now(),
        symbol: toast.symbol,
        targetPrice: toast.targetPrice,
        condition: toast.condition,
        message: toast.message,
      });
    },
    []
  );

  // Auto-dismiss MetaScalp toast
  useEffect(() => {
    if (metaScalpToast) {
      const timer = setTimeout(() => {
        setMetaScalpToast(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [metaScalpToast]);

  // Send ticker to MetaScalp terminal
  const handleSendToMetaScalp = useCallback(
    async (coin: ScannedCoin) => {
      if (!metaScalpSettings.enabled) {
        setIsMetaScalpModalOpen(true);
        return;
      }

      const res = await sendTickerToMetaScalp(
        coin.symbol,
        coin.exchange,
        coin.marketType,
        metaScalpSettings
      );

      if (res.success) {
        setMetaScalpToast({
          id: Date.now(),
          type: 'success',
          title: 'MetaScalp Оновлено',
          ticker: res.ticker,
          binding: res.binding,
          message: 'Стакан та графік синхронізовано',
        });
      } else {
        setMetaScalpToast({
          id: Date.now(),
          type: 'warning',
          title: 'MetaScalp',
          ticker: res.ticker,
          binding: res.binding,
          message: res.copiedToClipboard
            ? 'Термінал не відповів. Тікер скопійовано в буфер (Ctrl+V)!'
            : 'Термінал не знайдено на 127.0.0.1:17845.',
        });
      }
    },
    [metaScalpSettings]
  );

  // Handler when selecting pair for details modal
  const handleSelectPair = useCallback(
    (coin: ScannedCoin, formation?: DetectedFormation) => {
      const targetFormation =
        formation ||
        coin.bestFormation ||
        (coin.formations && coin.formations.length > 0 ? coin.formations[0] : undefined) || {
          id: `${coin.symbol}-view`,
          patternKey: 'chart_view',
          name: coin.symbol,
          nameEn: coin.symbol,
          category: 'breakout' as const,
          bias: coin.priceChange24h >= 0 ? 'bullish' : 'bearish',
          confidence: 70,
          status: 'forming' as const,
          statusLabel: 'Спостереження',
          description: `Моніторинг ${coin.symbol} (${coin.exchange.toUpperCase()})`,
          levels: {
            entryPrice: coin.currentPrice,
            targetPrice: coin.currentPrice * (coin.priceChange24h >= 0 ? 1.05 : 0.95),
            stopLossPrice: coin.currentPrice * (coin.priceChange24h >= 0 ? 0.97 : 1.03),
          },
          riskRewardRatio: 1.67,
          potentialProfitPct: 5,
          potentialRiskPct: 3,
          detectedAt: Date.now(),
        };

      setSelectedArchivedItem(null);
      setSelectedPair({ coin, formation: targetFormation });
      if (metaScalpSettings.enabled && metaScalpSettings.autoSwitchOnClick) {
        handleSendToMetaScalp(coin);
      }
    },
    [metaScalpSettings, handleSendToMetaScalp]
  );

  // Handler when selecting archived formation to restore
  const handleSelectArchivedFormation = useCallback(
    (archived: ArchivedFormation) => {
      const existingCoin = coins.find(
        (c) => c.symbol === archived.symbol && c.exchange === archived.exchange
      );
      const matchingCoin: ScannedCoin = existingCoin || {
        symbol: archived.symbol,
        baseAsset: archived.baseAsset,
        quoteAsset: archived.quoteAsset,
        exchange: archived.exchange,
        marketType: archived.marketType,
        currentPrice: archived.savedPrice,
        priceChange24h: 0,
        volume24hUsd: 0,
        highPrice24h: archived.savedPrice,
        lowPrice24h: archived.savedPrice,
        timeframe: archived.timeframe,
        formations: [archived.formation],
        hasFormations: true,
        bestFormation: archived.formation,
        exchangeUrl:
          archived.exchange === 'binance'
            ? `https://www.binance.com/uk-UA/trade/${archived.baseAsset}_${archived.quoteAsset}`
            : `https://www.bybit.com/trade/usdt/${archived.baseAsset}USDT`,
        lastUpdated: archived.savedAtTimestamp,
      };

      setSelectedArchivedItem(archived);
      setSelectedPair({
        coin: matchingCoin,
        formation: archived.formation,
      });
      setIsArchiveModalOpen(false);
      if (metaScalpSettings.enabled && metaScalpSettings.autoSwitchOnClick) {
        handleSendToMetaScalp(matchingCoin);
      }
    },
    [coins, metaScalpSettings, handleSendToMetaScalp]
  );

  // Play a gentle alert tone using Web Audio API
  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio playback not permitted yet:', e);
    }
  }, [soundEnabled]);

  // Fetch screener data from API
  const fetchScreenerData = useCallback(async (currentTf = filters.timeframe, currentExchange = filters.exchange, currentMarket = filters.marketType) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        timeframe: currentTf,
        exchange: currentExchange,
        marketType: currentMarket,
        minVolume: '0',
      });

      const res = await fetch(`/api/screener/scan?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Помилка сервера (${res.status})`);
      }
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Сервер тимчасово оновлює дані, спробуйте ще раз');
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setCoins(data.data);
        setLastUpdated(Date.now());

        // Check if there are high confidence formations to notify
        const hasHighConfidence = data.data.some((c: ScannedCoin) =>
          c.formations.some((f) => f.confidence >= 88)
        );
        if (hasHighConfidence) {
          playAlertSound();
        }
      } else {
        throw new Error(data.error || 'Не вдалося отримати дані');
      }
    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Помилка підключення до сканера');
    } finally {
      setIsLoading(false);
    }
  }, [filters.timeframe, filters.exchange, filters.marketType, filters.minVolumeUsd, playAlertSound]);

  // Initial load and re-fetch when exchange, market or timeframe changes
  useEffect(() => {
    fetchScreenerData(filters.timeframe, filters.exchange, filters.marketType);
  }, [filters.timeframe, filters.exchange, filters.marketType, filters.minVolumeUsd]);

  // Auto-refresh interval (every 60 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchScreenerData();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchScreenerData]);

  // Toggle watchlist (isolated per user profile)
  const handleToggleWatchlist = (symbol: string) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    setWatchlist((prev) => {
      const uniquePrev = Array.from(new Set(prev));
      const next = uniquePrev.includes(symbol)
        ? uniquePrev.filter((s) => s !== symbol)
        : [...uniquePrev, symbol];
      const cleanNext = Array.from(new Set(next));
      try {
        localStorage.setItem(`crypto_screener_watchlist_${user.uid}`, JSON.stringify(cleanNext));
      } catch (e) {}
      updateProfileData({ watchlist: cleanNext }).catch(() => {});
      return cleanNext;
    });
  };

  const handleWatchlistFoldersChange = (folders: Record<string, string[]>) => {
    if (!user) return;
    setWatchlistFolders(folders);
    try {
      localStorage.setItem(`crypto_screener_watchlist_folders_${user.uid}`, JSON.stringify(folders));
    } catch {}
    updateProfileData({ watchlistFolders: folders }).catch(() => {});
  };

  // Toggle sound
  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('crypto_screener_sound', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Flatten coins to items: { coin, formation }
  const flattenedItems = useMemo(() => {
    const items: { coin: ScannedCoin; formation: DetectedFormation }[] = [];

    for (const coin of coins) {
      // Filter by maximum volume
      if (filters.minVolumeUsd > 0 && coin.volume24hUsd > filters.minVolumeUsd) {
        continue;
      }

      // Filter by search query
      if (
        filters.searchQuery &&
        !coin.symbol.toLowerCase().includes(filters.searchQuery.toLowerCase()) &&
        !coin.baseAsset.toLowerCase().includes(filters.searchQuery.toLowerCase())
      ) {
        continue;
      }

      for (const formation of coin.formations) {
        // Filter by category
        if (filters.category !== 'all' && formation.category !== filters.category) {
          continue;
        }

        // Filter by bias
        if (filters.bias !== 'all' && formation.bias !== filters.bias) {
          continue;
        }

        // Filter by status
        if (filters.status !== 'all' && formation.status !== filters.status) {
          continue;
        }

        items.push({ coin, formation });
      }
    }

    // Sort items
    items.sort((a, b) => {
      if (filters.sortBy === 'confidence') {
        return b.formation.confidence - a.formation.confidence;
      }
      if (filters.sortBy === 'volume') {
        return b.coin.volume24hUsd - a.coin.volume24hUsd;
      }
      if (filters.sortBy === 'priceChange') {
        return Math.abs(b.coin.priceChange24h) - Math.abs(a.coin.priceChange24h);
      }
      if (filters.sortBy === 'profitPotential') {
        return b.formation.riskRewardRatio - a.formation.riskRewardRatio;
      }
      return 0;
    });

    return items;
  }, [coins, filters]);

  // Counts for header stats
  const bullishCount = useMemo(
    () => flattenedItems.filter((i) => i.formation.bias === 'bullish').length,
    [flattenedItems]
  );
  const bearishCount = useMemo(
    () => flattenedItems.filter((i) => i.formation.bias === 'bearish').length,
    [flattenedItems]
  );

  // Loading screen during initial authentication check
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070a12] flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 mb-4 animate-pulse">
          <Zap className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-base font-bold text-white font-mono tracking-wider mb-2 flex items-center gap-2">
          signal<span className="text-cyan-400">hook</span>
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-4 h-4 border-2 border-cyan-500/40 border-t-cyan-400 rounded-full animate-spin" />
          <span>Перевірка авторизації та доступу...</span>
        </div>
      </div>
    );
  }

  // Restricted Access Gate: access is restricted to unregistered users
  if (!user) {
    return (
      <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500/20 selection:text-cyan-300">
        {/* Header for Restricted Access */}
        <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-base tracking-tight text-white flex items-center gap-1 font-mono">
                signal<span className="text-cyan-400">hook</span>
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-400" />
                <span>Закритий скрінер</span>
              </span>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm shadow-cyan-900/30"
              >
                Увійти / Зареєструватися
              </button>
            </div>
          </div>
        </header>

        {/* Hero Section for Restricted Access */}
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-12 sm:py-16 flex flex-col items-center justify-center text-center space-y-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-500/20 via-cyan-500/20 to-indigo-500/20 border border-amber-500/30 flex items-center justify-center shadow-2xl shadow-amber-500/10">
            <ShieldAlert className="w-10 h-10 text-amber-400" />
          </div>

          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono font-medium">
              <Key className="w-3.5 h-3.5" />
              <span>РЕЄСТРАЦІЯ ТІЛЬКИ ЗА СПЕЦІАЛЬНИМ КОДОМ</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Доступ до скрінера формацій обмежено
            </h1>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Скрінер та аналіз графіків відкриті виключно для зареєстрованих трейдерів.
              Реєстрація здійснюється <strong>без підтвердження пошти за спеціальним кодом</strong>, який можна отримати тільки у Telegram каналі автора.
            </p>
          </div>

          {/* Feature Highlights with Personal Isolation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full text-left">
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                <Send className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Особисті Telegram сповіщення
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Кожен зареєстрований користувач має індивідуальні налаштування бота та власні алерти пробою рівнів.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Sliders className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Своя лінковка MetaScalp
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Персональні порти та група зв'язку з торговим терміналом MetaScalp збережені у вашому профілі.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Окремий список обраного
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ваші збережені монети, архів та налаштування фільтрів залишаються строго індивідуальними.
              </p>
            </div>
          </div>

          {/* Call to Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-md pt-2">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-cyan-900/40 cursor-pointer flex items-center justify-center gap-2"
            >
              <Key className="w-4 h-4 text-cyan-200" />
              <span>Зареєструватися або увійти</span>
            </button>

            <a
              href={AUTHOR_TELEGRAM_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-6 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4 text-sky-400" />
              <span>Telegram канал автора</span>
              <ExternalLink className="w-3.5 h-3.5 text-sky-400/80" />
            </a>
          </div>
        </main>

        {/* Auth Modal with isRestrictedMode={true} */}
        <AuthModal
          isOpen={isAuthModalOpen || !user}
          onClose={() => {
            if (user) setIsAuthModalOpen(false);
          }}
          isRestrictedMode={true}
          onSuccess={() => {
            setIsAuthModalOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Header */}
      {activePage !== 'terminal' && (
        <Header
          isLoading={isLoading}
          totalCoins={coins.length}
          formationsCount={flattenedItems.length}
          bullishCount={bullishCount}
          bearishCount={bearishCount}
          watchlistCount={watchlist.length}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          onRefresh={() => fetchScreenerData()}
          onOpenWatchlist={() => setIsWatchlistOpen(true)}
          onOpenArchive={() => setIsArchiveModalOpen(true)}
          archiveCount={archivedFormations.length}
          onOpenGuide={() => setIsGuideOpen(true)}
          onOpenMetaScalp={() => setIsMetaScalpModalOpen(true)}
          metaScalpSettings={metaScalpSettings}
          onOpenTelegramAlerts={() => handleOpenTelegramAlerts()}
          telegramAlertsCount={activeAlertsCount}
          lastUpdated={lastUpdated}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          activePage={activePage}
          onPageChange={handlePageChange}
        />
      )}

      {/* Main Content Area */}
      {activePage === 'terminal' ? (
        <TerminalPage
          coins={coins}
          watchlist={watchlist}
          onToggleWatchlist={handleToggleWatchlist}
          onSendMetaScalp={handleSendToMetaScalp}
          metaScalpBinding={metaScalpSettings.binding}
          onOpenTelegramAlerts={handleOpenTelegramAlerts}
          onOpenFullscreenModal={(coin, formation) => {
            setSelectedPair({ coin, formation: formation || coin.formations?.[0] || null });
          }}
          onReturnToPatterns={() => handlePageChange('patterns')}
        />
      ) : (
        <>
          <main className="flex-1 max-w-[1720px] w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
            {activePage === 'screener' ? (
              <CoinScreenerPage
                onSelectCoin={handleSelectPair}
                onSendMetaScalp={handleSendToMetaScalp}
                metaScalpBinding={metaScalpSettings.binding}
                watchlist={watchlist}
                onToggleWatchlist={handleToggleWatchlist}
                onOpenTelegramAlerts={handleOpenTelegramAlerts}
                onOpenWatchlist={() => setIsWatchlistOpen(true)}
                formationsCoins={coins}
              />
            ) : (
          <>
            {/* Filters Toolbar */}
            <ScreenerFilters
              filters={filters}
              onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />

            {/* Error Notification */}
            {error && (
              <div className="flex items-center justify-between p-4 rounded-2xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>{error}</span>
                </div>
                <button
                  onClick={() => fetchScreenerData()}
                  className="px-3 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-900 font-semibold transition-colors"
                >
                  Повторити
                </button>
              </div>
            )}

            {/* Results Area */}
            {isLoading && coins.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((idx) => (
                  <div
                    key={idx}
                    className="h-56 rounded-2xl bg-slate-900/40 border border-slate-800/60 animate-pulse p-4 space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <div className="h-5 w-24 bg-slate-800 rounded-md" />
                      <div className="h-5 w-16 bg-slate-800 rounded-md" />
                    </div>
                    <div className="h-16 bg-slate-800/60 rounded-xl" />
                    <div className="h-10 bg-slate-800/40 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : flattenedItems.length === 0 ? (
              <div className="py-20 text-center rounded-3xl border border-slate-800/80 bg-slate-900/40 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <Layers className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">Формацій не знайдено</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    За поточними фільтрами активних формацій не виявлено. Спробуйте змінити таймфрейм (5m / 15m / 1h / 4h), обрати обидві біржі або скинути фільтри.
                  </p>
                </div>
                <button
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
                >
                  Скинути фільтри
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {flattenedItems.map(({ coin, formation }, idx) => (
                  <FormationCard
                    key={`${coin.exchange}-${coin.symbol}-${coin.marketType}-${formation.id}-${idx}`}
                    coin={coin}
                    formation={formation}
                    isWatchlisted={watchlist.includes(coin.symbol)}
                    onToggleWatchlist={handleToggleWatchlist}
                    onSelect={handleSelectPair}
                    onSendMetaScalp={handleSendToMetaScalp}
                    metaScalpBinding={metaScalpSettings.binding}
                    onOpenAlert={(c, f) =>
                      handleOpenTelegramAlerts({
                        symbol: c.symbol,
                        exchange: c.exchange,
                        marketType: c.marketType,
                        currentPrice: c.currentPrice,
                        targetPrice: f.levels.targetPrice,
                        formationName: f.name,
                        condition: f.levels.targetPrice >= c.currentPrice ? 'gte' : 'lte',
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <ScreenerTable
                items={flattenedItems}
                watchlist={watchlist}
                onToggleWatchlist={handleToggleWatchlist}
                onSelect={handleSelectPair}
                onSendMetaScalp={handleSendToMetaScalp}
                metaScalpBinding={metaScalpSettings.binding}
                onOpenAlert={(c, f) =>
                  handleOpenTelegramAlerts({
                    symbol: c.symbol,
                    exchange: c.exchange,
                    marketType: c.marketType,
                    currentPrice: c.currentPrice,
                    targetPrice: f.levels.targetPrice,
                    formationName: f.name,
                    condition: f.levels.targetPrice >= c.currentPrice ? 'gte' : 'lte',
                  })
                }
              />
            )}
          </>
        )}
      </main>

      {/* Footer with Made in Evgen and Maksym */}
      <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/80 py-4 px-4 text-center">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <p>
            Made in <span className="text-cyan-400 font-semibold">Evgen</span> and <span className="text-indigo-400 font-semibold">Maksym</span>
          </p>
          <p className="text-[11px] text-slate-500 font-mono">
            signalhook • Binance &amp; Bybit Real-Time Pattern Screener
          </p>
        </div>
      </footer>
    </>
  )}

      {/* Formation Details Modal with Interactive Candlestick Chart & AI */}
      {selectedPair && (
        <FormationDetailsModal
          coin={selectedPair.coin}
          formation={selectedPair.formation}
          archivedItem={selectedArchivedItem}
          allCoins={coins}
          watchlist={watchlist}
          onToggleWatchlist={handleToggleWatchlist}
          onClose={() => {
            setSelectedPair(null);
            setSelectedArchivedItem(null);
          }}
          onSendMetaScalp={handleSendToMetaScalp}
          metaScalpBinding={metaScalpSettings.binding}
          onOpenTelegramModal={handleOpenTelegramAlerts}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onAlertToast={handleAlertToast}
        />
      )}

      {/* Formations Archive Modal */}
      <ArchiveModal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onSelectFormation={handleSelectArchivedFormation}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* Encyclopedia / Guide Modal */}
      <FormationGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />

      {/* Watchlist Drawer */}
      <WatchlistDrawer
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        watchlistSymbols={watchlist}
        allCoins={coins}
        onRemove={handleToggleWatchlist}
        folders={watchlistFolders}
        onFoldersChange={handleWatchlistFoldersChange}
        onSendMetaScalp={handleSendToMetaScalp}
        metaScalpBinding={metaScalpSettings.binding}
      />

      {/* MetaScalp Terminal Linking Modal */}
      <MetaScalpModal
        isOpen={isMetaScalpModalOpen}
        onClose={() => setIsMetaScalpModalOpen(false)}
        settings={metaScalpSettings}
        onSettingsChange={handleMetaScalpSettingsChange}
        currentSymbol={selectedPair?.coin.symbol || coins[0]?.symbol || 'BTCUSDT'}
      />

      {/* MetaScalp Notification Toast */}
      <MetaScalpToast
        toast={metaScalpToast}
        onDismiss={() => setMetaScalpToast(null)}
      />

      {/* Telegram Alerts & Configuration Modal */}
      <TelegramAlertsModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        prefill={telegramPrefill}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onAlertCreated={(alert) => {
          setAlertToast({
            id: Date.now(),
            symbol: alert.symbol,
            targetPrice: alert.targetPrice,
            condition: alert.condition,
            message: alert.note || alert.formationName || 'Алерт додано в чергу моніторингу',
          });
        }}
      />

      {/* User Authentication Modal (Registration / Login) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthModalOpen(false);
        }}
      />

      {/* User Profile & Isolated Settings Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onOpenAlerts={() => handleOpenTelegramAlerts()}
        onOpenArchive={() => setIsArchiveModalOpen(true)}
      />

      {/* Telegram Alert Notification Toast */}
      <AlertToast
        toast={alertToast}
        onDismiss={() => setAlertToast(null)}
      />
    </div>
  );
}
