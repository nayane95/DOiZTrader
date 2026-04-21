/* ===========================================================
 * CandlestickChart - Компонент свечного графика
 * Используем TradingView Lightweight Charts
 * =========================================================== */

import { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

/**
 * Класс для управления свечным графиком
 */
export class CandlestickChart {
    constructor(container, options = {}) {
        this.container = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        this.chart = null;
        this.candleSeries = null;
        this.volumeSeries = null;
        this.drawings = [];
        this.markers = [];
        this.candleData = [];
        this.candleMap = new Map();
        this.barInterval = 60;
        this.pricePrecision = 2;
        this.footprintBars = new Map();
        this.footprintCanvas = null;
        this.footprintCtx = null;
        this.pendingFootprintFrame = null;
        this.width = 0;
        this.height = 0;
        this.lastPrice = null;
        this.lastDelta = 0;
        this.autoFollow = true;
        this.hasInitialViewport = false;
        this.isApplyingViewport = false;
        this.viewportState = null;

        this.options = {
            theme: 'dark',
            showVolume: false,
            footprintStripRows: 4,
            ...options
        };
        this.candlePalette = {
            upColor: null,
            downColor: null
        };

        this._initChart();
        this._setupResizeObserver();
    }

    _getSeriesPalette(upColor = null, downColor = null, theme = this.options.theme) {
        const themeColors = this._getThemeColors(theme);
        const isDark = theme !== 'light';
        const resolvedUp = upColor || themeColors.candleUp;
        const resolvedDown = downColor || themeColors.candleDown;

        return {
            upColor: this._withAlpha(resolvedUp, isDark ? 0.22 : 0.32),
            downColor: this._withAlpha(resolvedDown, isDark ? 0.22 : 0.32),
            borderUpColor: this._withAlpha(resolvedUp, isDark ? 0.92 : 0.96),
            borderDownColor: this._withAlpha(resolvedDown, isDark ? 0.92 : 0.96),
            wickUpColor: this._withAlpha(resolvedUp, isDark ? 0.72 : 0.68),
            wickDownColor: this._withAlpha(resolvedDown, isDark ? 0.72 : 0.68)
        };
    }

    _getThemeColors(theme = this.options.theme) {
        const isDark = theme !== 'light';

        return {
            background: isDark ? '#0a0a0f' : '#ffffff',
            textColor: isDark ? '#8b8b8f' : '#3f4654',
            gridColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(31, 41, 55, 0.08)',
            crosshairColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(31, 41, 55, 0.32)',
            crosshairLabelBackground: isDark ? '#1a1a24' : '#ffffff',
            axisBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(31, 41, 55, 0.12)',
            footprintWick: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255, 77, 90, 0.92)',
            footprintDivider: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(31, 41, 55, 0.18)',
            footprintRowLine: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(31, 41, 55, 0.05)',
            footprintOuterBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(31, 41, 55, 0.09)',
            footprintBuyText: isDark ? '#e3fff0' : '#173438',
            footprintSellText: isDark ? '#ffe2e8' : '#4b2327',
            footprintNeutralText: isDark ? '#f3f5f7' : '#1f2937',
            footprintCompactBuyText: isDark ? '#d8ffea' : '#173438',
            footprintCompactSellText: isDark ? '#ffd7df' : '#4b2327',
            deltaLabelBackground: isDark ? 'rgba(8, 10, 16, 0.86)' : 'rgba(255, 255, 255, 0.88)',
            deltaLabelNeutral: isDark ? '#8b8b8f' : '#71819b',
            stripBackground: isDark ? 'rgba(9, 11, 16, 0.94)' : 'rgba(255, 255, 255, 0.92)',
            stripBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.12)',
            stripRowLine: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
            legendBackground: isDark ? 'rgba(11, 14, 22, 0.88)' : 'rgba(255, 255, 255, 0.92)',
            legendBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.12)',
            legendTitle: isDark ? '#f3f5f7' : '#162033',
            legendSubtitle: isDark ? '#8b8b8f' : '#71819b',
            legendPrice: isDark ? '#d8ffea' : '#0f6a44',
            candleUp: isDark ? '#00e676' : '#14b8a6',
            candleDown: isDark ? '#ff5252' : '#ff4d5a',
            summaryCardBackground: isDark ? 'rgba(17, 24, 39, 0.94)' : 'rgba(255, 255, 255, 0.96)',
            summaryCardBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(31, 41, 55, 0.08)',
            summaryCardShadow: isDark ? 'rgba(0, 0, 0, 0.32)' : 'rgba(15, 23, 42, 0.12)',
            summaryCardText: isDark ? '#f3f5f7' : '#1f2937',
            summaryCardLabel: isDark ? '#a7b0bc' : '#5f6b7b',
            highVolumeRow: isDark ? '#0b1017' : '#111111',
            highVolumeText: '#ffffff',
            bidHeatLow: isDark ? '#1f7f74' : '#c6ece7',
            bidHeatHigh: isDark ? '#00b8a0' : '#006d65',
            askHeatLow: isDark ? '#9f4858' : '#ffd3d8',
            askHeatHigh: isDark ? '#ff526d' : '#cf3048',
            sideTotalBid: isDark ? '#22c7b8' : '#16a394',
            sideTotalAsk: isDark ? '#ff6b83' : '#e64a64'
        };
    }

    /**
     * Инициализируем график
     * @private
     */
    _initChart() {
        const themeColors = this._getThemeColors();

        this.chart = createChart(this.container, {
            layout: {
                background: { type: ColorType.Solid, color: themeColors.background },
                textColor: themeColors.textColor,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: 12
            },
            grid: {
                vertLines: { color: themeColors.gridColor },
                horzLines: { color: themeColors.gridColor }
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: themeColors.crosshairColor,
                    width: 1,
                    style: 2,
                    labelBackgroundColor: themeColors.crosshairLabelBackground
                },
                horzLine: {
                    color: themeColors.crosshairColor,
                    width: 1,
                    style: 2,
                    labelBackgroundColor: themeColors.crosshairLabelBackground
                }
            },
            rightPriceScale: {
                borderColor: themeColors.axisBorder,
                scaleMargins: {
                    top: 0.06,
                    bottom: 0.2
                }
            },
            timeScale: {
                borderColor: themeColors.axisBorder,
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            },
            handleScale: {
                axisPressedMouseMove: {
                    time: true,
                    price: true
                }
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: true
            }
        });

        // Создаём серию свечей (v5 API: addSeries с типом)
        this.candleSeries = this.chart.addSeries(
            CandlestickSeries,
            this._getSeriesPalette(this.candlePalette.upColor, this.candlePalette.downColor, this.options.theme)
        );

        // Создаём серию объёма (v5 API)
        if (this.options.showVolume) {
            this.volumeSeries = this.chart.addSeries(HistogramSeries, {
                color: '#2979ff',
                priceFormat: { type: 'volume' },
                priceScaleId: 'volume', // Set a specific priceScaleId for volume
            });

            // Настраиваем отдельную шкалу для объёма
            this.chart.priceScale('volume').applyOptions({
                scaleMargins: {
                    top: 0.85, // Adjusted margin for volume scale
                    bottom: 0
                }
            });
        }

        this._initFootprintOverlay();

        this.chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (!this.isApplyingViewport && range) {
                this._captureViewportState(range);
                this.autoFollow = this._isRangeNearRealtime(range);
            }
            this._scheduleFootprintRender();
        });
    }

    /**
     * Загружаем исторические данные
     * @param {Array} data - [{ time, open, high, low, close, volume }, ...]
     */
    setData(data) {
        if (!data || !data.length) return;

        this.candleData = data.map(d => ({ ...d }));
        this.candleMap = new Map(this.candleData.map(d => [d.time, { ...d }]));
        this.barInterval = this._inferBarInterval(this.candleData);
        this.pricePrecision = this._inferPricePrecision(this.candleData);
        this._seedFootprintBars(this.candleData);

        // Форматируем данные для свечей
        const candleData = data.map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close
        }));

        this.candleSeries.setData(candleData);

        // Форматируем данные для объёма
        if (this.volumeSeries) {
            const volumeData = data.map(d => ({
                time: d.time,
                value: d.volume,
                color: d.close >= d.open
                    ? 'rgba(0,200,83,0.3)'
                    : 'rgba(255,23,68,0.3)'
            }));

            this.volumeSeries.setData(volumeData);
        }

        if (!this.hasInitialViewport) {
            this._focusRecentBars();
            this.hasInitialViewport = true;
        } else {
            this._restoreViewportAfterDataSet();
        }
        this._scheduleFootprintRender();
    }

    /**
     * Обновляем последнюю свечу (realtime)
     * @param {Object} candle - { time, open, high, low, close, volume }
     */
    updateCandle(candle) {
        if (!candle || !candle.time) return;

        // Защита от обновления старых данных
        // Lightweight Charts не позволяет обновлять свечи со временем раньше последней
        try {
            this.candleSeries.update({
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            });

            if (this.volumeSeries) {
                this.volumeSeries.update({
                    time: candle.time,
                    value: candle.volume,
                    color: candle.close >= candle.open
                        ? 'rgba(0,200,83,0.3)'
                        : 'rgba(255,23,68,0.3)'
                });
            }

            this._upsertCandle(candle);
            this._refreshSyntheticFootprint(candle);
            this.lastPrice = candle.close;
            if (this.autoFollow) {
                this._focusRecentBars();
            }
            this._scheduleFootprintRender();
        } catch (e) {
            // Игнорируем ошибку "Cannot update oldest data"
            // Это происходит когда WebSocket присылает старые данные
        }
    }

    addTrade(trade) {
        if (!trade) return;

        const price = Number(trade.price);
        const volume = Number(trade.volume ?? trade.qty);
        const timestamp = Number(trade.time);

        if (!Number.isFinite(price) || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(timestamp)) {
            return;
        }

        const tradeTime = timestamp > 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
        const barTime = this._getBarTime(tradeTime);
        const normalizedPrice = this._normalizePrice(price);
        const isBuy = trade.side === 'buy' || trade.isBuy === true || trade.isBuyerMaker === false;

        let footprint = this.footprintBars.get(barTime);
        if (!footprint) {
            const candle = this.candleMap.get(barTime) || {
                time: barTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume
            };
            footprint = this._createSyntheticFootprint(candle);
        }

        if (footprint.synthetic) {
            footprint = {
                time: barTime,
                buyVolume: 0,
                sellVolume: 0,
                delta: 0,
                levels: new Map(),
                synthetic: false
            };
        }

        const currentLevel = footprint.levels.get(normalizedPrice) || {
            price: normalizedPrice,
            buyVolume: 0,
            sellVolume: 0,
            totalVolume: 0
        };

        if (isBuy) {
            currentLevel.buyVolume += volume;
            footprint.buyVolume += volume;
        } else {
            currentLevel.sellVolume += volume;
            footprint.sellVolume += volume;
        }

        currentLevel.totalVolume = currentLevel.buyVolume + currentLevel.sellVolume;
        footprint.delta = footprint.buyVolume - footprint.sellVolume;
        footprint.levels.set(normalizedPrice, currentLevel);
        this.lastPrice = price;
        this.lastDelta = footprint.delta;

        this.footprintBars.set(barTime, footprint);
        this._trimFootprintBars();
        this._scheduleFootprintRender();
    }

    /**
     * Добавляем маркер на график (например, сделка)
     * @param {Object} marker - { time, position, color, shape, text }
     */
    addMarker(marker) {
        this.markers.push({
            time: marker.time,
            position: marker.position || 'aboveBar',
            color: marker.color || '#2979ff',
            shape: marker.shape || 'circle',
            text: marker.text || ''
        });

        this.candleSeries.setMarkers(this.markers);
    }

    /**
     * Очищаем маркеры
     */
    clearMarkers() {
        this.markers = [];
        this.candleSeries.setMarkers([]);
    }

    /**
     * Добавляем горизонтальную линию (уровень)
     * @param {number} price
     * @param {Object} options
     * @returns {Object} - Линия для удаления
     */
    addPriceLine(price, options = {}) {
        return this.candleSeries.createPriceLine({
            price,
            color: options.color || '#ffd600',
            lineWidth: options.lineWidth || 1,
            lineStyle: options.lineStyle || 2,
            axisLabelVisible: true,
            title: options.title || ''
        });
    }

    /**
     * Удаляем ценовую линию
     * @param {Object} line
     */
    removePriceLine(line) {
        this.candleSeries.removePriceLine(line);
    }

    /**
     * Получаем текущий видимый диапазон времени
     * @returns {{ from, to }}
     */
    getVisibleRange() {
        return this.chart.timeScale().getVisibleRange();
    }

    /**
     * Получаем видимый диапазон ЦЕН (для heatmap)
     * @returns {{ min, max } | null}
     */
    getVisiblePriceRange() {
        try {
            const priceScale = this.chart.priceScale('right');
            // Lightweight Charts v5 не имеет прямого метода getVisiblePriceRange
            // Используем данные свечей для определения диапазона
            const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
            if (!visibleRange) return null;

            // Получаем barsInLogicalRange не работает в v5, используем другой подход
            // Возвращаем null чтобы heatmap использовал свой fallback
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Получаем chart instance для прямого доступа
     */
    getChartInstance() {
        return this.chart;
    }

    /**
     * Получаем контейнер графика
     */
    getContainer() {
        return this.container;
    }

    /**
     * Подписываемся на crosshair move (для показа цены)
     * @param {Function} callback - (param) => {}
     */
    onCrosshairMove(callback) {
        this.chart.subscribeCrosshairMove(callback);
    }

    /**
     * Подписываемся на клик
     * @param {Function} callback
     */
    onClick(callback) {
        this.chart.subscribeClick(callback);
    }

    /**
     * Устанавливаем видимый диапазон
     * @param {number} from - Unix timestamp
     * @param {number} to - Unix timestamp
     */
    setVisibleRange(from, to) {
        this.chart.timeScale().setVisibleRange({ from, to });
    }

    /**
     * Скроллим к последней свече
     */
    scrollToRealTime() {
        this.autoFollow = true;
        this._focusRecentBars();
    }

    setCandlePalette(upColor, downColor) {
        if (!this.candleSeries) return;
        this.candlePalette = { upColor, downColor };

        this.candleSeries.applyOptions(this._getSeriesPalette(upColor, downColor, this.options.theme));

        this._scheduleFootprintRender();
    }

    /**
     * Следим за ресайзом контейнера
     * @private
     */
    _setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this.chart.resize(width, height);
                    this._resizeFootprintCanvas(width, height);
                }
            }
        });

        this.resizeObserver.observe(this.container);
    }

    /**
     * Меняем тему
     * @param {string} theme - 'dark' | 'light'
     */
    setTheme(theme) {
        const normalizedTheme = theme === 'light' ? 'light' : 'dark';
        const themeColors = this._getThemeColors(normalizedTheme);
        this.options.theme = normalizedTheme;

        this.chart.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: themeColors.background },
                textColor: themeColors.textColor
            },
            grid: {
                vertLines: { color: themeColors.gridColor },
                horzLines: { color: themeColors.gridColor }
            },
            crosshair: {
                vertLine: {
                    color: themeColors.crosshairColor,
                    labelBackgroundColor: themeColors.crosshairLabelBackground
                },
                horzLine: {
                    color: themeColors.crosshairColor,
                    labelBackgroundColor: themeColors.crosshairLabelBackground
                }
            },
            rightPriceScale: {
                borderColor: themeColors.axisBorder
            },
            timeScale: {
                borderColor: themeColors.axisBorder
            }
        });

        if (this.candleSeries) {
            this.candleSeries.applyOptions(
                this._getSeriesPalette(this.candlePalette.upColor, this.candlePalette.downColor, normalizedTheme)
            );
        }

        this._scheduleFootprintRender();
    }

    /**
     * Уничтожаем график
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.pendingFootprintFrame) {
            cancelAnimationFrame(this.pendingFootprintFrame);
        }
        if (this.footprintCanvas?.parentNode) {
            this.footprintCanvas.parentNode.removeChild(this.footprintCanvas);
        }
        if (this.chart) {
            this.chart.remove();
        }
    }

    _initFootprintOverlay() {
        this.container.style.position = 'relative';
        this.footprintCanvas = document.createElement('canvas');
        this.footprintCanvas.className = 'footprint-overlay';
        this.footprintCanvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 6;
        `;

        this.container.appendChild(this.footprintCanvas);
        this.footprintCtx = this.footprintCanvas.getContext('2d', { alpha: true });

        const rect = this.container.getBoundingClientRect();
        this._resizeFootprintCanvas(rect.width, rect.height);
    }

    _resizeFootprintCanvas(width, height) {
        if (!this.footprintCanvas || !this.footprintCtx) return;

        const dpr = window.devicePixelRatio || 1;
        this.width = Math.max(0, Math.floor(width));
        this.height = Math.max(0, Math.floor(height));

        this.footprintCanvas.width = this.width * dpr;
        this.footprintCanvas.height = this.height * dpr;
        this.footprintCanvas.style.width = `${this.width}px`;
        this.footprintCanvas.style.height = `${this.height}px`;
        this.footprintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._scheduleFootprintRender();
    }

    _scheduleFootprintRender() {
        if (!this.footprintCtx || this.pendingFootprintFrame) return;

        this.pendingFootprintFrame = requestAnimationFrame(() => {
            this.pendingFootprintFrame = null;
            this._renderFootprints();
        });
    }

    _renderFootprints() {
        if (!this.footprintCtx || !this.candleSeries || !this.chart || !this.width || !this.height) {
            return;
        }

        this.footprintCtx.clearRect(0, 0, this.width, this.height);

        const visibleBars = this.candleData
            .map(candle => ({
                candle,
                footprint: this.footprintBars.get(candle.time),
                x: this.chart.timeScale().timeToCoordinate(candle.time)
            }))
            .filter(item => item.footprint && item.x !== null && item.x >= -60 && item.x <= this.width + 60);

        if (!visibleBars.length) {
            return;
        }

        const summaryStride = this._getOverlayStride(visibleBars, 132);
        const deltaStride = this._getOverlayStride(visibleBars, 56);

        visibleBars.forEach((item, index) => {
            const barWidth = this._getBarWidth(visibleBars, index);
            const detailLevel = this._getFootprintDetailLevel(barWidth);

            if (detailLevel === 'hidden') {
                return;
            }

            this._drawFootprintBar(item.candle, item.footprint, item.x, barWidth, detailLevel);

            if (detailLevel === 'full' && index % summaryStride === 0) {
                this._drawFootprintSummaryCard(item.candle, item.footprint, item.x, barWidth);
            } else if ((detailLevel === 'medium' || detailLevel === 'compact') && index % deltaStride === 0) {
                this._drawDeltaLabel(item.candle, item.footprint, item.x, barWidth);
            }
        });
    }

    _drawFootprintBar(candle, footprint, x, barWidth, detailLevel = this._getFootprintDetailLevel(barWidth)) {
        if (!footprint || barWidth < 12) return;
        const themeColors = this._getThemeColors();

        const highY = this.candleSeries.priceToCoordinate(candle.high);
        const lowY = this.candleSeries.priceToCoordinate(candle.low);
        const openY = this.candleSeries.priceToCoordinate(candle.open);
        const closeY = this.candleSeries.priceToCoordinate(candle.close);

        if (highY === null || lowY === null || openY === null || closeY === null) return;

        const shellTop = Math.min(highY, lowY);
        const shellBottom = Math.max(highY, lowY);
        const shellHeight = Math.max(shellBottom - shellTop, 14);
        const targetRows = this._getResponsiveRowCount(shellHeight, detailLevel);
        const rows = this._buildFootprintRows(candle, footprint, shellTop, shellBottom, targetRows);

        if (!rows.length) return;

        const layout = this._getCompositeLayout(x, barWidth);
        const maxRowVolume = Math.max(...rows.map(row => row.totalVolume), 1);
        const maxCellVolume = Math.max(
            ...rows.flatMap(row => [row.sellVolume, row.buyVolume]),
            1
        );
        const borderColor = candle.close >= candle.open ? themeColors.candleUp : themeColors.candleDown;
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const candleCenterX = layout.candleCenterX;
        const buyTotal = rows.reduce((sum, row) => sum + row.buyVolume, 0);
        const sellTotal = rows.reduce((sum, row) => sum + row.sellVolume, 0);

        this.footprintCtx.strokeStyle = themeColors.footprintWick;
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(candleCenterX, highY);
        this.footprintCtx.lineTo(candleCenterX, lowY);
        this.footprintCtx.stroke();

        this.footprintCtx.fillStyle = candle.close >= candle.open
            ? this._withAlpha(themeColors.candleUp, this.options.theme === 'light' ? 0.98 : 0.26)
            : this._withAlpha(themeColors.candleDown, this.options.theme === 'light' ? 0.98 : 0.26);
        this.footprintCtx.fillRect(
            layout.candleLeft,
            bodyTop,
            layout.candleWidth,
            Math.max(bodyBottom - bodyTop, 2)
        );

        this.footprintCtx.strokeStyle = borderColor;
        this.footprintCtx.lineWidth = 1.2;
        this.footprintCtx.strokeRect(
            layout.candleLeft + 0.5,
            bodyTop + 0.5,
            Math.max(layout.candleWidth - 1, 1),
            Math.max(bodyBottom - bodyTop - 1, 1)
        );

        const showCellText = detailLevel === 'full' || (detailLevel === 'medium' && layout.sideWidth >= 20);
        const showCellBorders = detailLevel === 'full' || detailLevel === 'medium';
        const showRowGuides = detailLevel !== 'minimal';
        const cellInset = detailLevel === 'full'
            ? Math.max(1, Math.min(4, layout.sideWidth * 0.08))
            : detailLevel === 'medium'
                ? Math.max(1, Math.min(3, layout.sideWidth * 0.05))
                : 0;
        const cellWidth = Math.max(3, layout.sideWidth - cellInset * 2);
        const fontSize = detailLevel === 'full'
            ? (layout.sideWidth >= 34 ? 8 : 7)
            : layout.sideWidth >= 24 ? 7 : 6;

        rows.forEach((row, index) => {
            const rowTop = index === 0 ? shellTop : rows[index - 1].boundaryBottom;
            const rowBottom = row.boundaryBottom;
            const rowHeight = Math.max(rowBottom - rowTop - 1, 1);
            const totalIntensity = row.totalVolume / maxRowVolume;
            const sellIntensity = row.sellVolume / maxCellVolume;
            const buyIntensity = row.buyVolume / maxCellVolume;
            const sellHighlighted = row.sellVolume > 0 && sellIntensity >= 0.82;
            const buyHighlighted = row.buyVolume > 0 && buyIntensity >= 0.82;
            const sellFill = sellHighlighted
                ? themeColors.highVolumeRow
                : this._blendColors(
                    themeColors.askHeatLow,
                    themeColors.askHeatHigh,
                    Math.max(0.08, Math.min(1, sellIntensity))
                );
            const buyFill = buyHighlighted
                ? themeColors.highVolumeRow
                : this._blendColors(
                    themeColors.bidHeatLow,
                    themeColors.bidHeatHigh,
                    Math.max(0.08, Math.min(1, buyIntensity))
                );
            const sellText = sellHighlighted ? themeColors.highVolumeText : (sellIntensity >= 0.58 ? '#ffffff' : themeColors.footprintSellText);
            const buyText = buyHighlighted ? themeColors.highVolumeText : (buyIntensity >= 0.58 ? '#ffffff' : themeColors.footprintBuyText);

            if (showRowGuides) {
                this.footprintCtx.strokeStyle = themeColors.footprintRowLine;
                this.footprintCtx.lineWidth = 1;
                this.footprintCtx.beginPath();
                this.footprintCtx.moveTo(layout.leftColumnLeft, rowTop + 0.5);
                this.footprintCtx.lineTo(layout.rightColumnRight, rowTop + 0.5);
                this.footprintCtx.stroke();
            }

            if (row.sellVolume > 0) {
                this.footprintCtx.fillStyle = sellFill;
                this.footprintCtx.fillRect(layout.leftColumnLeft + cellInset, rowTop, cellWidth, rowHeight);
            }

            if (row.buyVolume > 0) {
                this.footprintCtx.fillStyle = buyFill;
                this.footprintCtx.fillRect(layout.rightColumnLeft + cellInset, rowTop, cellWidth, rowHeight);
            }

            if (showCellBorders && (row.sellVolume > 0 || row.buyVolume > 0)) {
                this.footprintCtx.strokeStyle = this.options.theme === 'light'
                    ? 'rgba(255, 255, 255, 0.78)'
                    : 'rgba(255,255,255,0.12)';
                this.footprintCtx.lineWidth = 1;
                this.footprintCtx.strokeRect(layout.leftColumnLeft + cellInset + 0.5, rowTop + 0.5, Math.max(cellWidth - 1, 1), Math.max(rowHeight - 1, 1));
                this.footprintCtx.strokeRect(layout.rightColumnLeft + cellInset + 0.5, rowTop + 0.5, Math.max(cellWidth - 1, 1), Math.max(rowHeight - 1, 1));
            }

            if (showCellText) {
                this.footprintCtx.font = `600 ${fontSize}px Inter, sans-serif`;
                this.footprintCtx.textBaseline = 'middle';
                this.footprintCtx.textAlign = 'center';

                if (row.sellVolume > 0) {
                    this.footprintCtx.fillStyle = sellText;
                    this.footprintCtx.fillText(
                        this._formatFootprintValue(row.sellVolume),
                        layout.leftColumnLeft + cellInset + cellWidth / 2,
                        rowTop + rowHeight / 2
                    );
                }

                if (row.buyVolume > 0) {
                    this.footprintCtx.fillStyle = buyText;
                    this.footprintCtx.fillText(
                        this._formatFootprintValue(row.buyVolume),
                        layout.rightColumnLeft + cellInset + cellWidth / 2,
                        rowTop + rowHeight / 2
                    );
                }
            }
        });

        this.footprintCtx.strokeStyle = themeColors.footprintOuterBorder;
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(layout.leftColumnLeft + 0.5, shellTop);
        this.footprintCtx.lineTo(layout.leftColumnLeft + 0.5, shellBottom);
        this.footprintCtx.stroke();

        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(layout.leftColumnRight - 0.5, shellTop);
        this.footprintCtx.lineTo(layout.leftColumnRight - 0.5, shellBottom);
        this.footprintCtx.stroke();

        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(layout.rightColumnRight - 0.5, shellTop);
        this.footprintCtx.lineTo(layout.rightColumnRight - 0.5, shellBottom);
        this.footprintCtx.stroke();

        if (detailLevel === 'full') {
            const totalsY = Math.min(this.height - 6, shellBottom + 18);
            this.footprintCtx.font = '600 9px Inter, sans-serif';
            this.footprintCtx.textAlign = 'center';
            this.footprintCtx.textBaseline = 'middle';
            this.footprintCtx.fillStyle = themeColors.sideTotalAsk;
            this.footprintCtx.fillText(
                this._formatFootprintValue(sellTotal),
                layout.leftColumnLeft + layout.sideWidth / 2,
                totalsY
            );
            this.footprintCtx.fillStyle = themeColors.sideTotalBid;
            this.footprintCtx.fillText(
                this._formatFootprintValue(buyTotal),
                layout.rightColumnLeft + layout.sideWidth / 2,
                totalsY
            );
        }
    }

    _getCompositeLayout(x, barWidth) {
        const totalWidth = Math.min(Math.max(barWidth * 1.08, 28), 92);
        const gap = totalWidth >= 64 ? 4 : 3;
        const candleWidth = Math.min(Math.max(barWidth * 0.2, 4), 10);
        const sideWidth = Math.max(10, Math.floor((totalWidth - candleWidth - gap * 2) / 2));
        const left = x - totalWidth / 2;
        const leftColumnLeft = left;
        const candleLeft = leftColumnLeft + sideWidth + gap;
        const rightColumnLeft = candleLeft + candleWidth + gap;

        return {
            totalWidth,
            leftColumnLeft,
            leftColumnRight: leftColumnLeft + sideWidth,
            rightColumnLeft,
            rightColumnRight: rightColumnLeft + sideWidth,
            sideWidth,
            rowGap: gap,
            candleLeft,
            candleWidth,
            candleCenterX: candleLeft + candleWidth / 2,
            footprintCenterX: x
        };
    }

    _getFootprintDetailLevel(barWidth) {
        if (barWidth >= 30) return 'full';
        if (barWidth >= 22) return 'medium';
        if (barWidth >= 16) return 'compact';
        if (barWidth >= 12) return 'minimal';
        return 'hidden';
    }

    _getResponsiveRowCount(shellHeight, detailLevel) {
        switch (detailLevel) {
            case 'full':
                return Math.max(10, Math.min(24, Math.round(shellHeight / 10)));
            case 'medium':
                return Math.max(8, Math.min(18, Math.round(shellHeight / 13)));
            case 'compact':
                return Math.max(5, Math.min(10, Math.round(shellHeight / 18)));
            case 'minimal':
                return Math.max(3, Math.min(5, Math.round(shellHeight / 28)));
            default:
                return 0;
        }
    }

    _getOverlayStride(visibleBars, minSpacing) {
        if (visibleBars.length < 2) return 1;

        let smallestGap = Infinity;

        for (let index = 1; index < visibleBars.length; index++) {
            const gap = Math.abs(visibleBars[index].x - visibleBars[index - 1].x);
            if (gap > 0) {
                smallestGap = Math.min(smallestGap, gap);
            }
        }

        if (!Number.isFinite(smallestGap) || smallestGap <= 0) {
            return 1;
        }

        return Math.max(1, Math.ceil(minSpacing / smallestGap));
    }

    _drawDeltaLabel(candle, footprint, x, barWidth) {
        if (!candle || !footprint || barWidth < 10) return;
        const themeColors = this._getThemeColors();
        const highY = this.candleSeries?.priceToCoordinate(candle.high);
        if (highY === null) return;

        const delta = footprint.delta || 0;
        const label = this._formatSignedFootprintValue(delta);
        const layout = this._getCompositeLayout(x, barWidth);
        const labelX = layout.footprintCenterX;
        const fontSize = Math.min(10, Math.max(7, barWidth * 0.32));
        const labelHeight = fontSize >= 9 ? 16 : 14;

        this.footprintCtx.font = `700 ${fontSize}px Inter, sans-serif`;
        const textWidth = this.footprintCtx.measureText(label).width;
        const labelWidth = Math.max(28, Math.min(84, textWidth + 14));
        const left = Math.max(2, Math.min(this.width - labelWidth - 2, labelX - labelWidth / 2));
        const top = Math.max(4, highY - labelHeight - 6);
        const deltaColor = delta > 0 ? '#00e676' : delta < 0 ? '#ff5252' : themeColors.deltaLabelNeutral;
        const badgeBackground = delta === 0
            ? themeColors.deltaLabelBackground
            : this._withAlpha(deltaColor, this.options.theme === 'light' ? 0.12 : 0.18);
        const badgeBorder = delta === 0
            ? themeColors.footprintOuterBorder
            : this._withAlpha(deltaColor, this.options.theme === 'light' ? 0.32 : 0.42);

        this.footprintCtx.fillStyle = badgeBackground;
        this.footprintCtx.fillRect(left, top, labelWidth, labelHeight);
        this.footprintCtx.strokeStyle = badgeBorder;
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.strokeRect(left + 0.5, top + 0.5, labelWidth - 1, labelHeight - 1);

        this.footprintCtx.textAlign = 'center';
        this.footprintCtx.textBaseline = 'middle';
        this.footprintCtx.fillStyle = deltaColor;
        this.footprintCtx.fillText(label, left + labelWidth / 2, top + labelHeight / 2);
    }

    _drawFootprintSummaryCard(candle, footprint, x, barWidth) {
        if (!candle || !footprint) return;

        const themeColors = this._getThemeColors();
        const lowY = this.candleSeries?.priceToCoordinate(candle.low);
        if (lowY === null) return;

        const layout = this._getCompositeLayout(x, barWidth);
        const delta = footprint.delta || 0;
        const total = (footprint.buyVolume || 0) + (footprint.sellVolume || 0);
        const deltaText = this._formatSignedFootprintValue(delta);
        const totalText = this._formatFootprintValue(total);
        const labelFontSize = layout.sideWidth >= 44 ? 8 : 7;
        const valueFontSize = layout.sideWidth >= 44 ? 9 : 8;
        const cardWidth = Math.max(104, Math.min(138, layout.sideWidth * 2.15));
        const cardHeight = 38;
        const cardLeft = Math.max(2, Math.min(this.width - cardWidth - 2, x - cardWidth / 2));
        const cardTop = Math.min(this.height - cardHeight - 4, lowY + 10);
        const deltaColor = delta > 0 ? '#14b8a6' : delta < 0 ? '#ff4d5a' : themeColors.deltaLabelNeutral;

        this.footprintCtx.save();
        this.footprintCtx.shadowColor = themeColors.summaryCardShadow;
        this.footprintCtx.shadowBlur = this.options.theme === 'light' ? 10 : 6;
        this.footprintCtx.shadowOffsetY = 2;
        this.footprintCtx.fillStyle = themeColors.summaryCardBackground;
        this._fillRoundedRect(cardLeft, cardTop, cardWidth, cardHeight, 8);
        this.footprintCtx.restore();

        this.footprintCtx.save();
        this.footprintCtx.strokeStyle = themeColors.summaryCardBorder;
        this.footprintCtx.lineWidth = 1;
        this._strokeRoundedRect(cardLeft + 0.5, cardTop + 0.5, cardWidth - 1, cardHeight - 1, 8);
        this.footprintCtx.restore();

        this.footprintCtx.save();
        this.footprintCtx.font = `500 ${labelFontSize}px Inter, sans-serif`;
        this.footprintCtx.fillStyle = themeColors.summaryCardLabel;
        this.footprintCtx.textAlign = 'left';
        this.footprintCtx.textBaseline = 'top';
        this.footprintCtx.fillText('Delta', cardLeft + 12, cardTop + 9);
        this.footprintCtx.fillText('Total', cardLeft + 12, cardTop + 21);

        this.footprintCtx.font = `700 ${valueFontSize}px Inter, sans-serif`;
        this.footprintCtx.fillStyle = deltaColor;
        this.footprintCtx.fillText(deltaText, cardLeft + 46, cardTop + 8);

        this.footprintCtx.fillStyle = themeColors.summaryCardText;
        this.footprintCtx.fillText(totalText, cardLeft + 46, cardTop + 20);
        this.footprintCtx.restore();
    }

    _fillRoundedRect(x, y, width, height, radius) {
        this.footprintCtx.beginPath();
        this._roundedRectPath(x, y, width, height, radius);
        this.footprintCtx.fill();
    }

    _strokeRoundedRect(x, y, width, height, radius) {
        this.footprintCtx.beginPath();
        this._roundedRectPath(x, y, width, height, radius);
        this.footprintCtx.stroke();
    }

    _roundedRectPath(x, y, width, height, radius) {
        const r = Math.max(0, Math.min(radius, width / 2, height / 2));

        this.footprintCtx.moveTo(x + r, y);
        this.footprintCtx.lineTo(x + width - r, y);
        this.footprintCtx.quadraticCurveTo(x + width, y, x + width, y + r);
        this.footprintCtx.lineTo(x + width, y + height - r);
        this.footprintCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        this.footprintCtx.lineTo(x + r, y + height);
        this.footprintCtx.quadraticCurveTo(x, y + height, x, y + height - r);
        this.footprintCtx.lineTo(x, y + r);
        this.footprintCtx.quadraticCurveTo(x, y, x + r, y);
        this.footprintCtx.closePath();
    }

    _drawBottomVolumetricStrip(visibleBars) {
        if (!visibleBars.length) return;
        const themeColors = this._getThemeColors();

        const stripHeight = Math.max(42, Math.min(68, this.height * 0.16));
        const top = this.height - stripHeight;
        const rowCount = this.options.footprintStripRows || 4;
        const rowHeight = stripHeight / rowCount;
        const maxTotal = Math.max(...visibleBars.map(item => (item.footprint?.buyVolume || 0) + (item.footprint?.sellVolume || 0)), 1);
        const maxDelta = Math.max(...visibleBars.map(item => Math.abs(item.footprint?.delta || 0)), 1);

        this.footprintCtx.save();
        this.footprintCtx.fillStyle = themeColors.stripBackground;
        this.footprintCtx.fillRect(0, top, this.width, stripHeight);
        this.footprintCtx.strokeStyle = themeColors.stripBorder;
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(0, top + 0.5);
        this.footprintCtx.lineTo(this.width, top + 0.5);
        this.footprintCtx.stroke();

        for (let row = 1; row < rowCount; row++) {
            const y = top + row * rowHeight;
            this.footprintCtx.strokeStyle = themeColors.stripRowLine;
            this.footprintCtx.beginPath();
            this.footprintCtx.moveTo(0, y + 0.5);
            this.footprintCtx.lineTo(this.width, y + 0.5);
            this.footprintCtx.stroke();
        }

        visibleBars.forEach((item, index) => {
            const footprint = item.footprint;
            if (!footprint) return;

            const barWidth = this._getBarWidth(visibleBars, index);
            const cellWidth = Math.max(4, Math.min(18, barWidth * 0.92));
            const left = item.x - cellWidth / 2;
            const totalVolume = footprint.buyVolume + footprint.sellVolume;
            const deltaAbs = Math.abs(footprint.delta);
            const deltaPositive = footprint.delta >= 0;

            const cells = [
                {
                    color: 'rgba(255, 214, 0, 0.18)',
                    fill: totalVolume / maxTotal,
                    accent: '#ffd600'
                },
                {
                    color: 'rgba(0, 200, 83, 0.18)',
                    fill: footprint.buyVolume / maxTotal,
                    accent: '#00e676'
                },
                {
                    color: 'rgba(255, 23, 68, 0.18)',
                    fill: footprint.sellVolume / maxTotal,
                    accent: '#ff5252'
                },
                {
                    color: deltaPositive ? 'rgba(0, 200, 83, 0.22)' : 'rgba(255, 23, 68, 0.22)',
                    fill: deltaAbs / maxDelta,
                    accent: deltaPositive ? '#00e676' : '#ff5252'
                }
            ];

            cells.forEach((cell, rowIndex) => {
                const cellTop = top + rowIndex * rowHeight + 1;
                const cellInnerHeight = Math.max(rowHeight - 2, 1);

                this.footprintCtx.fillStyle = cell.color;
                this.footprintCtx.fillRect(left, cellTop, cellWidth, cellInnerHeight);

                this.footprintCtx.fillStyle = cell.accent;
                this.footprintCtx.fillRect(left, cellTop, cellWidth * Math.max(0.08, Math.min(cell.fill, 1)), cellInnerHeight);
            });
        });

        this.footprintCtx.restore();
    }

    _drawChartLegend(latestFootprint) {
        const themeColors = this._getThemeColors();
        const legendWidth = 196;
        const legendHeight = 58;
        const x = 12;
        const y = 10;
        const currentDelta = latestFootprint?.delta ?? this.lastDelta ?? 0;
        const currentPrice = this.lastPrice ?? this.candleData[this.candleData.length - 1]?.close ?? null;

        this.footprintCtx.save();
        this.footprintCtx.fillStyle = themeColors.legendBackground;
        this.footprintCtx.fillRect(x, y, legendWidth, legendHeight);
        this.footprintCtx.strokeStyle = themeColors.legendBorder;
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.strokeRect(x + 0.5, y + 0.5, legendWidth - 1, legendHeight - 1);

        this.footprintCtx.font = '600 11px Inter, sans-serif';
        this.footprintCtx.textAlign = 'left';
        this.footprintCtx.textBaseline = 'top';
        this.footprintCtx.fillStyle = themeColors.legendTitle;
        this.footprintCtx.fillText('Value Footprint', x + 10, y + 8);

        this.footprintCtx.font = '500 9px Inter, sans-serif';
        this.footprintCtx.fillStyle = themeColors.legendSubtitle;
        this.footprintCtx.fillText('Candle left, bid x ask ladder right', x + 10, y + 24);

        this.footprintCtx.fillStyle = '#ffd600';
        this.footprintCtx.fillText(`Delta ${this._formatSignedFootprintValue(currentDelta)}`, x + 10, y + 39);

        if (currentPrice !== null) {
            this.footprintCtx.fillStyle = themeColors.legendPrice;
            this.footprintCtx.fillText(`Last ${Number(currentPrice).toFixed(this.pricePrecision)}`, x + 102, y + 39);
        }

        this.footprintCtx.restore();
    }

    _buildFootprintRows(candle, footprint, highY, lowY, rowsOverride = null) {
        const priceHigh = Number(candle.high);
        const priceLow = Number(candle.low);
        const range = Math.max(priceHigh - priceLow, Number.EPSILON);
        const shellHeight = Math.max(lowY - highY, 12);
        const desiredRows = rowsOverride ?? Math.max(6, Math.min(16, Math.round(shellHeight / 13)));

        const rows = Array.from({ length: desiredRows }, (_, index) => {
            const ratio = desiredRows === 1 ? 0.5 : index / (desiredRows - 1);
            return {
                index,
                price: this._normalizePrice(priceHigh - ratio * range),
                y: highY + ratio * shellHeight,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                boundaryBottom: highY + ((index + 1) / desiredRows) * shellHeight,
                height: shellHeight / desiredRows
            };
        });

        for (const level of footprint.levels.values()) {
            const normalizedPrice = Number(level.price);
            const priceRatio = (priceHigh - normalizedPrice) / range;
            const rowIndex = Math.max(0, Math.min(desiredRows - 1, Math.round(priceRatio * (desiredRows - 1))));
            const row = rows[rowIndex];

            row.buyVolume += level.buyVolume;
            row.sellVolume += level.sellVolume;
            row.totalVolume += level.totalVolume;
        }

        if (!rows.some(row => row.totalVolume > 0) && footprint.buyVolume + footprint.sellVolume > 0) {
            const middleIndex = Math.floor(desiredRows / 2);
            rows[middleIndex].buyVolume = footprint.buyVolume;
            rows[middleIndex].sellVolume = footprint.sellVolume;
            rows[middleIndex].totalVolume = footprint.buyVolume + footprint.sellVolume;
        }

        return rows;
    }

    _getBarWidth(visibleBars, index) {
        const current = visibleBars[index];
        const prev = visibleBars[index - 1];
        const next = visibleBars[index + 1];

        let spacing = Infinity;
        if (prev) spacing = Math.min(spacing, Math.abs(current.x - prev.x));
        if (next) spacing = Math.min(spacing, Math.abs(next.x - current.x));

        if (!Number.isFinite(spacing) || spacing <= 0) {
            spacing = this.width / Math.max(visibleBars.length, 1);
        }

        return Math.max(10, Math.min(96, spacing * 0.94));
    }

    _focusRecentBars(spanOverride = null) {
        if (!this.chart || this.candleData.length < 2) return;

        const lastIndex = this.candleData.length - 1;
        const span = Math.max(6, spanOverride ?? this.viewportState?.span ?? this._getDefaultVisibleSpan());
        const rightPadding = this.viewportState?.rightPadding ?? 2;
        const to = lastIndex + rightPadding;
        const from = to - span;

        this._applyLogicalRange({ from, to });
    }

    _isRangeNearRealtime(range) {
        if (!range || this.candleData.length < 2) return true;

        const lastIndex = this.candleData.length - 1;
        return range.to >= lastIndex + 0.25;
    }

    _captureViewportState(range) {
        if (!range) return;

        const lastIndex = Math.max(0, this.candleData.length - 1);
        const span = Math.max(2, range.to - range.from);

        this.viewportState = {
            from: range.from,
            to: range.to,
            span,
            rightPadding: range.to - lastIndex
        };
    }

    _restoreViewportAfterDataSet() {
        if (!this.chart || this.candleData.length < 2) return;

        if (this.autoFollow) {
            this._focusRecentBars(this.viewportState?.span);
            return;
        }

        if (this.viewportState) {
            this._applyLogicalRange({
                from: this.viewportState.from,
                to: this.viewportState.to
            });
            return;
        }

        this._focusRecentBars();
    }

    _applyLogicalRange(range) {
        if (!this.chart || !range) return;

        try {
            this.isApplyingViewport = true;
            this.chart.timeScale().setVisibleLogicalRange(range);
        } catch (error) {
            // Ignore initial range errors during first chart mount.
        } finally {
            requestAnimationFrame(() => {
                this.isApplyingViewport = false;
            });
        }
    }

    _getDefaultVisibleSpan() {
        return Math.max(10, Math.min(22, Math.round(this.width / 78) || 14));
    }

    _seedFootprintBars(data) {
        this.footprintBars.clear();
        data.forEach(candle => {
            this.footprintBars.set(candle.time, this._createSyntheticFootprint(candle));
        });
    }

    _createSyntheticFootprint(candle) {
        const buyShare = this._estimateBuyShare(candle);
        const volume = Number(candle.volume) || 0;
        const high = Number(candle.high);
        const low = Number(candle.low);
        const range = Math.max(high - low, 0);
        const levels = new Map();

        if (range <= Number.EPSILON || volume <= 0) {
            const buyVolume = volume * buyShare;
            const sellVolume = Math.max(0, volume - buyVolume);
            const levelPrice = this._normalizePrice(candle.close);

            return {
                time: candle.time,
                buyVolume,
                sellVolume,
                delta: buyVolume - sellVolume,
                synthetic: true,
                levels: new Map([
                    [levelPrice, {
                        price: levelPrice,
                        buyVolume,
                        sellVolume,
                        totalVolume: volume
                    }]
                ])
            };
        }

        const direction = Math.sign((candle.close || 0) - (candle.open || 0));
        const levelsCount = Math.max(10, Math.min(30, Math.round(
            10 +
            Math.abs((candle.close - candle.open) / range) * 8 +
            Math.log10(volume + 1) * 2
        )));
        const weights = [];

        for (let index = 0; index < levelsCount; index++) {
            const ratio = levelsCount === 1 ? 0.5 : index / (levelsCount - 1);
            const price = this._normalizePrice(high - ratio * range);
            const proximityToClose = 1 - Math.min(1, Math.abs(price - candle.close) / range);
            const centerWeight = 1 - Math.min(1, Math.abs(ratio - 0.5) * 1.2);
            const weight = 0.45 + (proximityToClose * 0.35) + (centerWeight * 0.2);

            weights.push(weight);
            levels.set(price, {
                price,
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0
            });
        }

        const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;

        [...levels.values()].forEach((level, index) => {
            const ratio = levelsCount === 1 ? 0.5 : index / (levelsCount - 1);
            const allocatedVolume = volume * (weights[index] / weightSum);
            const directionalSkew = direction === 0 ? 0 : (0.18 * direction * (0.5 - ratio));
            const levelBuyShare = Math.min(0.88, Math.max(0.12, buyShare + directionalSkew));

            level.buyVolume = allocatedVolume * levelBuyShare;
            level.sellVolume = Math.max(0, allocatedVolume - level.buyVolume);
            level.totalVolume = allocatedVolume;
        });

        const buyVolume = [...levels.values()].reduce((sum, level) => sum + level.buyVolume, 0);
        const sellVolume = [...levels.values()].reduce((sum, level) => sum + level.sellVolume, 0);

        return {
            time: candle.time,
            buyVolume,
            sellVolume,
            delta: buyVolume - sellVolume,
            synthetic: true,
            levels
        };
    }

    _estimateBuyShare(candle) {
        const range = Math.max((candle.high || 0) - (candle.low || 0), Number.EPSILON);
        const bodyBias = ((candle.close || 0) - (candle.open || 0)) / range;
        return Math.min(0.85, Math.max(0.15, 0.5 + (bodyBias * 0.35)));
    }

    _upsertCandle(candle) {
        const clonedCandle = { ...candle };
        this.candleMap.set(candle.time, clonedCandle);

        const lastIndex = this.candleData.findIndex(item => item.time === candle.time);
        if (lastIndex >= 0) {
            this.candleData[lastIndex] = clonedCandle;
        } else {
            this.candleData.push(clonedCandle);
            this.candleData.sort((a, b) => a.time - b.time);
            this.barInterval = this._inferBarInterval(this.candleData);
        }
    }

    _refreshSyntheticFootprint(candle) {
        const footprint = this.footprintBars.get(candle.time);
        if (!footprint || footprint.synthetic) {
            this.footprintBars.set(candle.time, this._createSyntheticFootprint(candle));
        }
        this._trimFootprintBars();
    }

    _trimFootprintBars() {
        const maxBars = Math.max(this.candleData.length + 10, 350);
        if (this.footprintBars.size <= maxBars) return;

        const sortedKeys = [...this.footprintBars.keys()].sort((a, b) => a - b);
        while (sortedKeys.length > maxBars) {
            const key = sortedKeys.shift();
            this.footprintBars.delete(key);
        }
    }

    _inferBarInterval(data) {
        for (let i = 1; i < data.length; i++) {
            const diff = Number(data[i].time) - Number(data[i - 1].time);
            if (Number.isFinite(diff) && diff > 0) {
                return diff;
            }
        }
        return this.barInterval || 60;
    }

    _inferPricePrecision(data) {
        const sample = data.find(candle => Number.isFinite(candle.close));
        if (!sample) return 2;

        const price = Math.abs(sample.close);
        if (price >= 1000) return 2;
        if (price >= 100) return 2;
        if (price >= 1) return 4;
        if (price >= 0.1) return 5;
        return 6;
    }

    _normalizePrice(price) {
        return Number(price.toFixed(this.pricePrecision));
    }

    _getBarTime(timestamp) {
        return Math.floor(timestamp / this.barInterval) * this.barInterval;
    }

    _formatFootprintValue(value) {
        if (!value) return '0';

        const absolute = Math.abs(value);

        if (absolute >= 1_000_000) {
            return `${(value / 1_000_000).toFixed(3).replace(/\.?0+$/, '')} M`;
        }

        if (absolute >= 1_000) {
            return `${(value / 1_000).toFixed(3).replace(/\.?0+$/, '')} K`;
        }

        if (absolute >= 100) {
            return value.toFixed(0);
        }

        if (absolute >= 10) {
            return value.toFixed(1).replace(/\.0$/, '');
        }

        return value.toFixed(2).replace(/\.?0+$/, '');
    }

    _formatSignedFootprintValue(value) {
        const sign = value > 0 ? '+' : value < 0 ? '-' : '';
        return `${sign}${this._formatFootprintValue(Math.abs(value))}`;
    }

    _withAlpha(color, alpha) {
        if (!color) return `rgba(255,255,255,${alpha})`;

        const hex = color.replace('#', '').trim();
        if (hex.length !== 6) return color;

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    _blendColors(fromColor, toColor, intensity = 0.5) {
        const from = this._parseColor(fromColor);
        const to = this._parseColor(toColor);
        const weight = Math.max(0, Math.min(1, intensity));

        if (!from || !to) {
            return toColor || fromColor || '#ffffff';
        }

        const r = Math.round(from.r + ((to.r - from.r) * weight));
        const g = Math.round(from.g + ((to.g - from.g) * weight));
        const b = Math.round(from.b + ((to.b - from.b) * weight));

        return `rgb(${r}, ${g}, ${b})`;
    }

    _parseColor(color) {
        if (!color) return null;

        const hex = color.replace('#', '').trim();
        if (hex.length !== 6) return null;

        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }
}
