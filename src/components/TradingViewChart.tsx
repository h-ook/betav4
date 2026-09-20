import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  LineStyle,
  IPriceLine,
} from 'lightweight-charts';
import { Maximize2, ZoomIn, Activity, Layers, Clock, Expand, FolderArchive, CheckCircle2 } from 'lucide-react';
import { Kline, DetectedFormation, Timeframe, ExchangeId, MarketType, ChartMarkerInfo, ChartRestoreParams } from '../types';
import { getChartPriceFormat, formatCryptoPrice } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';

interface TradingViewChartProps {
  klines: Kline[];
  formation?: DetectedFormation | null;
  symbol: string;
  timeframe: string;
  exchange?: ExchangeId;
  marketType?: MarketType;
  historyLimit?: number;
  onHistoryLimitChange?: (limit: number) => void;
  onTimeframeChange?: (timeframe: Timeframe) => void;
  onLivePriceUpdate?: (price: number) => void;
  onOpenFullscreen?: () => void;
  onAddToArchive?: () => void;
  isArchived?: boolean;
  isSavingArchive?: boolean;
  customMarkers?: ChartMarkerInfo[];
  savedChartParams?: ChartRestoreParams;
  fullHeight?: boolean;
  hideHeader?: boolean;
  showVolume?: boolean;
  overlayBadge?: string;
  overlaySubtext?: string;
}

// Convert timeframe string to Binance WS interval
function toBinanceWsInterval(tf: string): string {
  switch (tf) {
    case '1m': return '1m';
    case '5m': return '5m';
    case '15m': return '15m';
    case '1h': return '1h';
    case '4h': return '4h';
    case '1d': return '1d';
    default: return '1h';
  }
}

// Convert timeframe string to Bybit WS interval
function toBybitWsInterval(tf: string): string {
  switch (tf) {
    case '1m': return '1';
    case '5m': return '5';
    case '15m': return '15';
    case '1h': return '60';
    case '4h': return '240';
    case '1d': return 'D';
    default: return '60';
  }
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  klines,
  formation,
  symbol,
  timeframe,
  exchange = 'binance',
  marketType = 'futures',
  historyLimit = 1000,
  onHistoryLimitChange,
  onTimeframeChange,
  onLivePriceUpdate,
  onOpenFullscreen,
  onAddToArchive,
  isArchived,
  isSavingArchive,
  customMarkers,
  savedChartParams,
  fullHeight = false,
  hideHeader = false,
  showVolume = true,
  overlayBadge,
  overlaySubtext,
}) => {
  const { profile } = useAuth();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastTickTimeRef = useRef<number>(0);
  const latestPriceRef = useRef<number | null>(null);
  const klinesLengthRef = useRef<number>(klines.length);

  // Real-time state
  const [currentPrice, setCurrentPrice] = useState<number | null>(() => {
    return klines.length > 0 ? klines[klines.length - 1].close : null;
  });
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [liveMode, setLiveMode] = useState<'ws' | 'rest'>('rest');
  const [tickAnimation, setTickAnimation] = useState<boolean>(false);
  const defaultLabelState = profile?.chartLabelSettings || { entry: true, target: true, stop: true };
  const [showEntryLevel, setShowEntryLevel] = useState<boolean>(defaultLabelState.entry);
  const [showTargetLevel, setShowTargetLevel] = useState<boolean>(defaultLabelState.target);
  const [showStopLevel, setShowStopLevel] = useState<boolean>(defaultLabelState.stop);

  useEffect(() => {
    const nextSettings = profile?.chartLabelSettings || { entry: true, target: true, stop: true };
    setShowEntryLevel(nextSettings.entry);
    setShowTargetLevel(nextSettings.target);
    setShowStopLevel(nextSettings.stop);
  }, [profile?.chartLabelSettings]);

  // Update latest price ref
  useEffect(() => {
    if (klines.length > 0) {
      const p = klines[klines.length - 1].close;
      setCurrentPrice((prev) => prev ?? p);
      latestPriceRef.current = p;
    }
    klinesLengthRef.current = klines.length;
  }, [klines]);

  // Fit content helper
  const handleFitAll = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, []);

  // Zoom to recent candles
  const handleZoomRecent = useCallback(() => {
    if (chartRef.current && klinesLengthRef.current > 0) {
      const total = klinesLengthRef.current;
      const visible = Math.min(80, total);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: total - visible,
        to: total + 4,
      });
    }
  }, []);

  // Update current live candle and price
  const handleLiveTick = useCallback(
    (candle: { time: number; open: number; high: number; low: number; close: number; volume?: number }, mode: 'ws' | 'rest') => {
      if (!candleSeriesRef.current) return;

      try {
        candleSeriesRef.current.update({
          time: candle.time as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });

        const prevPrice = latestPriceRef.current;
        if (prevPrice !== null && candle.close !== prevPrice) {
          setPriceDirection(candle.close > prevPrice ? 'up' : 'down');
          setTickAnimation(true);
          setTimeout(() => setTickAnimation(false), 500);
        }

        if (volumeSeriesRef.current && candle.volume !== undefined) {
          volumeSeriesRef.current.update({
            time: candle.time as Time,
            value: candle.volume,
            color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
          });
        }

        latestPriceRef.current = candle.close;
        setCurrentPrice(candle.close);
        lastTickTimeRef.current = Date.now();
        setIsLiveConnected(true);
        setLiveMode(mode);
        onLivePriceUpdate?.(candle.close);
      } catch (err) {
        // Ignored
      }
    },
    [onLivePriceUpdate]
  );

  // Initialize Lightweight Charts
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      autoSize: true,
      layout: {
        background: { color: '#090d16' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        vertLine: {
          color: '#64748b',
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: '#64748b',
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      timeScale: {
        borderColor: 'rgba(51, 65, 85, 0.8)',
        timeVisible: true,
        secondsVisible: false,
        shiftVisibleRangeOnNewBar: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(51, 65, 85, 0.8)',
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        alignLabels: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const initialPrice = klines[klines.length - 1]?.close || formation?.levels.entryPrice || 1;
    const initialPriceFormat = getChartPriceFormat(initialPrice);

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: initialPriceFormat,
    });

    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });
    }

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    let resizeTimer: any;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (chartRef.current && chartContainerRef.current) {
          const width = chartContainerRef.current.clientWidth;
          const height = chartContainerRef.current.clientHeight;
          if (width > 0 && height > 0) {
            chartRef.current.applyOptions({ width, height });
            chartRef.current.timeScale().fitContent();
          }
        }
      }, 60);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [showVolume]);

  // Update data and price lines when klines change
  useEffect(() => {
    if (!candleSeriesRef.current || !chartRef.current || !klines.length) return;

    const refPrice = klines[klines.length - 1]?.close || formation?.levels.entryPrice || 1;
    const priceFormatConfig = getChartPriceFormat(refPrice);
    candleSeriesRef.current.applyOptions({
      priceFormat: priceFormatConfig,
    });

    const chartData: CandlestickData<Time>[] = klines.map((k) => ({
      time: k.time as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const uniqueSortedData = chartData
      .filter((item, index, self) => index === self.findIndex((t) => t.time === item.time))
      .sort((a, b) => (a.time as number) - (b.time as number));

    candleSeriesRef.current.setData(uniqueSortedData);

    // Update Volume Histogram
    if (volumeSeriesRef.current) {
      const volData: HistogramData<Time>[] = klines.map((k) => ({
        time: k.time as Time,
        value: k.volume || 0,
        color: k.close >= k.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      }));
      const uniqueVolData = volData
        .filter((item, index, self) => index === self.findIndex((t) => t.time === item.time))
        .sort((a, b) => (a.time as number) - (b.time as number));
      volumeSeriesRef.current.setData(uniqueVolData);
    }

    // Initial positioning: show last 80 candles comfortably spaced (or restore saved range)
    const totalBars = uniqueSortedData.length;
    if (savedChartParams?.visibleRange && totalBars > 0) {
      chartRef.current.timeScale().setVisibleLogicalRange(savedChartParams.visibleRange);
    } else if (totalBars > 0) {
      const visibleBars = Math.min(80, totalBars);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: totalBars - visibleBars,
        to: totalBars + 4,
      });
    }

    // Remove existing price lines
    priceLinesRef.current.forEach((pl) => {
      try {
        candleSeriesRef.current?.removePriceLine(pl);
      } catch {
        // Ignored
      }
    });
    priceLinesRef.current = [];

    // Draw custom markers if passed from archive
    if (Array.isArray(customMarkers) && customMarkers.length > 0 && candleSeriesRef.current) {
      customMarkers.forEach((marker) => {
        let style = LineStyle.Solid;
        if (marker.lineStyle === 'dashed') style = LineStyle.Dashed;
        else if (marker.lineStyle === 'dotted') style = LineStyle.Dotted;

        const line = candleSeriesRef.current?.createPriceLine({
          price: marker.price,
          color: marker.color,
          lineWidth: (marker.lineWidth as any) || 2,
          lineStyle: style,
          axisLabelVisible: true,
          title: marker.label ? `${marker.label}` : '',
        });
        if (line) {
          priceLinesRef.current.push(line);
        }
      });
    } else if (formation && candleSeriesRef.current) {
      // Draw formation price levels if available
      if (showEntryLevel && formation.levels.entryPrice) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.entryPrice,
          color: '#38bdf8',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Вхід',
        });
        priceLinesRef.current.push(line);
      }

      if (showTargetLevel && formation.levels.targetPrice) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.targetPrice,
          color: '#10b981',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: 'Ціль',
        });
        priceLinesRef.current.push(line);
      }

      if (showStopLevel && formation.levels.stopLossPrice) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.stopLossPrice,
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: 'Стоп',
        });
        priceLinesRef.current.push(line);
      }

      if (
        formation.levels.necklinePrice &&
        Math.abs(formation.levels.necklinePrice - formation.levels.entryPrice) > 0.0001 &&
        Math.abs(formation.levels.necklinePrice - formation.levels.targetPrice) > 0.0001
      ) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.necklinePrice,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '',
        });
        priceLinesRef.current.push(line);
      }

      if (
        formation.levels.resistancePrice &&
        Math.abs(formation.levels.resistancePrice - formation.levels.entryPrice) > 0.0001 &&
        Math.abs(formation.levels.resistancePrice - formation.levels.targetPrice) > 0.0001 &&
        (!formation.levels.necklinePrice || Math.abs(formation.levels.resistancePrice - formation.levels.necklinePrice) > 0.0001)
      ) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.resistancePrice,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '',
        });
        priceLinesRef.current.push(line);
      }

      if (
        formation.levels.supportPrice &&
        Math.abs(formation.levels.supportPrice - formation.levels.stopLossPrice) > 0.0001 &&
        Math.abs(formation.levels.supportPrice - formation.levels.entryPrice) > 0.0001
      ) {
        const line = candleSeriesRef.current.createPriceLine({
          price: formation.levels.supportPrice,
          color: '#a855f7',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '',
        });
        priceLinesRef.current.push(line);
      }
    }
  }, [klines, formation, customMarkers, showEntryLevel, showTargetLevel, showStopLevel, savedChartParams]);

  // Real-Time Live Stream Connection (WebSocket + Fast REST Poller fallback)
  useEffect(() => {
    let isDisposed = false;
    let ws: WebSocket | null = null;
    let pollInterval: any = null;

    const cleanSymbol = symbol.toUpperCase().replace('/', '').trim();

    // 1. Setup WebSocket
    try {
      if (exchange === 'binance') {
        const interval = toBinanceWsInterval(timeframe);
        const wsUrl =
          marketType === 'futures'
            ? `wss://fstream.binance.com/ws/${cleanSymbol.toLowerCase()}@kline_${interval}`
            : `wss://stream.binance.com:9443/ws/${cleanSymbol.toLowerCase()}@kline_${interval}`;

        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(event.data);
            if (data.e === 'kline' && data.k) {
              const k = data.k;
              handleLiveTick(
                {
                  time: Math.floor(k.t / 1000),
                  open: parseFloat(k.o),
                  high: parseFloat(k.h),
                  low: parseFloat(k.l),
                  close: parseFloat(k.c),
                  volume: parseFloat(k.v),
                },
                'ws'
              );
            }
          } catch {
            // Ignored
          }
        };

        ws.onopen = () => {
          if (!isDisposed) {
            setIsLiveConnected(true);
            setLiveMode('ws');
          }
        };

        ws.onerror = () => {
          // Handled smoothly by fallback poller
        };
      } else {
        // Bybit
        const wsUrl =
          marketType === 'futures'
            ? 'wss://stream.bybit.com/v5/public/linear'
            : 'wss://stream.bybit.com/v5/public/spot';

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (isDisposed) return;
          setIsLiveConnected(true);
          setLiveMode('ws');
          try {
            const interval = toBybitWsInterval(timeframe);
            ws?.send(
              JSON.stringify({
                op: 'subscribe',
                args: [`kline.${interval}.${cleanSymbol}`],
              })
            );
          } catch {
            // Ignored
          }
        };

        ws.onmessage = (event) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(event.data);
            if (data.topic && data.topic.startsWith('kline') && Array.isArray(data.data) && data.data[0]) {
              const item = data.data[0];
              handleLiveTick(
                {
                  time: Math.floor(parseInt(item.start, 10) / 1000),
                  open: parseFloat(item.open),
                  high: parseFloat(item.high),
                  low: parseFloat(item.low),
                  close: parseFloat(item.close),
                  volume: parseFloat(item.volume || '0'),
                },
                'ws'
              );
            }
          } catch {
            // Ignored
          }
        };
      }
    } catch {
      // WS setup failed, fallback poller will operate
    }

    // 2. High-Frequency Poller Fallback (ensures live updates in iframes/sandboxes)
    const runFastPoll = async () => {
      if (isDisposed) return;
      // If WebSocket has ticked within the last 4 seconds, skip REST poll to save bandwidth
      if (Date.now() - lastTickTimeRef.current < 4000 && ws && ws.readyState === WebSocket.OPEN) {
        return;
      }

      try {
        const res = await fetch(
          `/api/klines?exchange=${exchange}&market=${marketType}&symbol=${cleanSymbol}&timeframe=${timeframe}&limit=3`
        );
        const json = await res.json();
        if (!isDisposed && json.success && Array.isArray(json.data) && json.data.length > 0) {
          const latest = json.data[json.data.length - 1];
          handleLiveTick(latest, 'rest');
        }
      } catch {
        // Ignored
      }
    };

    pollInterval = setInterval(runFastPoll, 2500);

    return () => {
      isDisposed = true;
      if (pollInterval) clearInterval(pollInterval);
      if (ws) {
        try {
          ws.close();
        } catch {
          // Ignored
        }
      }
    };
  }, [symbol, timeframe, exchange, marketType, handleLiveTick]);

  const historyOptions = [150, 300, 500, 1000];

  if (hideHeader) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-[#090d16] flex flex-col select-none">
        {/* Top-left scalp overlay badge (matching the screenshot) */}
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 pointer-events-none text-[10px] font-mono select-none">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/85 backdrop-blur-sm border border-slate-700/60 text-slate-300 shadow-sm">
            <span className="text-cyan-400">🔍</span>
            <span>{overlaySubtext || 'Ликв: тихо • 44 с открытия'}</span>
          </div>
          {overlayBadge && (
            <div className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold uppercase tracking-wider text-[9px] shadow-sm">
              {overlayBadge}
            </div>
          )}
        </div>

        {/* Bottom-left volume label (matching the screenshot) */}
        {showVolume !== false && (
          <div className="absolute bottom-6 left-2 z-20 pointer-events-none text-[10px] text-slate-500 font-mono select-none">
            Объём
          </div>
        )}

        {/* Chart Canvas */}
        <div ref={chartContainerRef} className="w-full h-full flex-1" />
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden border border-slate-800 bg-slate-950 shadow-xl flex flex-col ${fullHeight ? 'h-full flex-1 rounded-none border-0' : 'rounded-2xl'}`}>
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 bg-slate-900/95 border-b border-slate-800 text-xs z-10 shrink-0">
        {/* Left: Symbol, Live Price, Badges */}
        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
          <span className="font-bold text-slate-100 font-mono text-xs sm:text-sm tracking-wide">{symbol}</span>

          {/* Live Price Tag */}
          {currentPrice !== null && (
            <div
              className={`flex items-center gap-1 font-mono font-bold px-1.5 sm:px-2 py-0.5 rounded-lg border text-[11px] sm:text-xs transition-all duration-300 ${
                tickAnimation
                  ? priceDirection === 'up'
                    ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500 scale-105 shadow-sm shadow-emerald-500/20'
                    : 'bg-rose-500/30 text-rose-300 border-rose-500 scale-105 shadow-sm shadow-rose-500/20'
                  : priceDirection === 'up'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                  : priceDirection === 'down'
                  ? 'bg-rose-950/60 text-rose-400 border-rose-800/60'
                  : 'bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              <span>${formatCryptoPrice(currentPrice)}</span>
              {priceDirection === 'up' ? (
                <span className="text-[9px] sm:text-[10px] text-emerald-400 font-extrabold">▲</span>
              ) : priceDirection === 'down' ? (
                <span className="text-[9px] sm:text-[10px] text-rose-400 font-extrabold">▼</span>
              ) : null}
            </div>
          )}

          {/* Live Stream Status Indicator */}
          <div
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-mono font-medium ${
              isLiveConnected
                ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
            title={`Оновлення в реальному часі (${liveMode.toUpperCase()})`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isLiveConnected ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isLiveConnected ? 'bg-emerald-500' : 'bg-slate-500'
                }`}
              ></span>
            </span>
            <span className="font-bold tracking-wider">
              LIVE {liveMode === 'ws' ? '⚡' : '●'}
            </span>
          </div>

          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] sm:text-[11px]">
            {timeframe}
          </span>

          {formation && (
            <span
              className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-medium truncate max-w-[130px] sm:max-w-none ${
                formation.bias === 'bullish'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : formation.bias === 'bearish'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
              title={formation.name}
            >
              {formation.name}
            </span>
          )}
        </div>

  
        {/* Right: History Depth Selector & View Controls */}
        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 text-slate-300 text-[10px] sm:text-[11px]">
          {/* History Depth Selector */}
          {onHistoryLimitChange && (
            <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-950 px-1 sm:px-1.5 py-0.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 font-medium hidden md:inline">Історія:</span>
              {historyOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onHistoryLimitChange(opt)}
                  className={`px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-mono transition-colors cursor-pointer ${
                    historyLimit === opt
                      ? 'bg-cyan-600 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Завантажити ${opt} свічок в історію`}
                >
                  {opt}
                </button>
              ))}
              <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">бар</span>
            </div>
          )}

          {/* Zoom Recent Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleZoomRecent}
              className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700 text-[10px] sm:text-[11px] cursor-pointer active:scale-95"
              title="Наблизити до останніх 80 свічок"
            >
              <ZoomIn className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Останні свічки</span>
            </button>

            <button
              onClick={handleFitAll}
              className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700 text-[10px] sm:text-[11px] cursor-pointer active:scale-95"
              title="Вписати всю завантажену історію свічок"
            >
              <Maximize2 className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">Вся історія</span>
              <span className="font-mono">({klines.length})</span>
            </button>

 
          </div>
        </div>
      </div>

      {onTimeframeChange && (
        <div className="flex items-center justify-between gap-2 px-2.5 sm:px-4 py-1.5 bg-slate-900/60 border-b border-slate-800/80">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-mono">
              {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((option) => (
                <button
                  key={option}
                  onClick={() => onTimeframeChange(option)}
                  className={`px-2 sm:px-2.5 py-1 rounded transition-colors ${
                    timeframe === option ? 'bg-cyan-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            {formation && (
              <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] sm:text-[11px]">
                {[
                  { key: 'entry', label: 'Вхід', enabled: showEntryLevel, activeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
                  { key: 'target', label: 'Ціль', enabled: showTargetLevel, activeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
                  { key: 'stop', label: 'Стоп', enabled: showStopLevel, activeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      if (item.key === 'entry') setShowEntryLevel((value) => !value);
                      if (item.key === 'target') setShowTargetLevel((value) => !value);
                      if (item.key === 'stop') setShowStopLevel((value) => !value);
                    }}
                    className={`px-1.5 sm:px-2 py-1 rounded-md border transition-colors ${
                      item.enabled ? item.activeClass : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                    title={`${item.enabled ? 'Вимкнути' : 'Увімкнути'} мітку ${item.label}`}
                    aria-label={`${item.enabled ? 'Вимкнути' : 'Увімкнути'} мітку ${item.label}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {onAddToArchive && (
              <button
                type="button"
                onClick={onAddToArchive}
                disabled={isSavingArchive}
                className="p-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 transition-colors disabled:opacity-50"
                title={isArchived ? 'Формацію збережено в архіві' : 'Додати монету та формацію в архів'}
                aria-label={isArchived ? 'Формацію збережено в архіві' : 'Додати монету та формацію в архів'}
              >
                {isArchived ? <CheckCircle2 className="w-3.5 h-3.5" /> : <FolderArchive className={`w-3.5 h-3.5 ${isSavingArchive ? 'animate-pulse' : ''}`} />}
              </button>
            )}
            {onOpenFullscreen && (
              <button
                type="button"
                onClick={onOpenFullscreen}
                className="p-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 transition-colors"
                title="Відкрити повний графік"
                aria-label="Відкрити повний графік"
              >
                <Expand className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Levels Sub-header when formation present */}
      {formation && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 bg-slate-900/60 border-b border-slate-800/80 text-[10px] sm:text-[11px] font-mono">
          <div className="flex items-center flex-wrap gap-2 sm:gap-4">
            <span className="flex items-center gap-1 text-sky-300 font-medium">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-sky-400"></span> Вхід: ${formatCryptoPrice(formation.levels.entryPrice)}
            </span>
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500"></span> Ціль: ${formatCryptoPrice(formation.levels.targetPrice)} (+{Math.abs(formation.potentialProfitPct)}%)
            </span>
            <span className="flex items-center gap-1 text-rose-400 font-bold">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-rose-500"></span> Стоп: ${formatCryptoPrice(formation.levels.stopLossPrice)} (-{Math.abs(formation.potentialRiskPct)}%)
            </span>
          </div>
          <div className="text-slate-400 font-medium text-[10px] sm:text-[11px]">
            R:R <span className="text-cyan-400 font-bold">1:{formation.riskRewardRatio}</span>
          </div>
        </div>
      )}

      {/* Chart Canvas */}
      <div
        ref={chartContainerRef}
        className={fullHeight ? "w-full flex-1 min-h-[220px]" : "w-full h-[300px] xs:h-[350px] sm:h-[420px] md:h-[480px] lg:h-[540px] xl:h-[580px] 2xl:h-[640px]"}
      />
    </div>
  );
};
