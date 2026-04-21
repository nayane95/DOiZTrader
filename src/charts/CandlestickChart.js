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

        this._initChart();
        this._setupResizeObserver();
    }

    _getSeriesPalette(upColor = '#00e676', downColor = '#ff5252') {
        return {
            upColor: this._withAlpha(upColor, 0.03),
            downColor: this._withAlpha(downColor, 0.03),
            borderUpColor: this._withAlpha(upColor, 0.16),
            borderDownColor: this._withAlpha(downColor, 0.16),
            wickUpColor: this._withAlpha(upColor, 0.12),
            wickDownColor: this._withAlpha(downColor, 0.12)
        };
    }

    /**
     * Инициализируем график
     * @private
     */
    _initChart() {
        const isDark = this.options.theme === 'dark';

        this.chart = createChart(this.container, {
            layout: {
                background: { type: ColorType.Solid, color: isDark ? '#0a0a0f' : '#ffffff' },
                textColor: isDark ? '#8b8b8f' : '#333333',
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: 12
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: isDark ? '#1a1a24' : '#f0f0f0'
                },
                horzLine: {
                    color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: isDark ? '#1a1a24' : '#f0f0f0'
                }
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                scaleMargins: {
                    top: 0.06,
                    bottom: 0.2
                }
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
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
        this.candleSeries = this.chart.addSeries(CandlestickSeries, this._getSeriesPalette());

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

        this.candleSeries.applyOptions(this._getSeriesPalette(upColor, downColor));

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
        const isDark = theme === 'dark';

        this.chart.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: isDark ? '#0a0a0f' : '#ffffff' },
                textColor: isDark ? '#8b8b8f' : '#333333'
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }
            }
        });

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

        visibleBars.forEach((item, index) => {
            const barWidth = this._getBarWidth(visibleBars, index);
            this._drawFootprintBar(item.candle, item.footprint, item.x, barWidth);

            if (barWidth >= 10) {
                this._drawDeltaLabel(item.footprint, item.x, barWidth);
            }
        });

        this._drawBottomVolumetricStrip(visibleBars);
        this._drawChartLegend(visibleBars[visibleBars.length - 1]?.footprint);
    }

    _drawFootprintBar(candle, footprint, x, barWidth) {
        if (!footprint || barWidth < 14) return;

        const highY = this.candleSeries.priceToCoordinate(candle.high);
        const lowY = this.candleSeries.priceToCoordinate(candle.low);
        const openY = this.candleSeries.priceToCoordinate(candle.open);
        const closeY = this.candleSeries.priceToCoordinate(candle.close);

        if (highY === null || lowY === null || openY === null || closeY === null) return;

        const shellTop = Math.min(highY, lowY);
        const shellBottom = Math.max(highY, lowY);
        const shellHeight = Math.max(shellBottom - shellTop, 14);
        const rows = this._buildFootprintRows(candle, footprint, shellTop, shellBottom);

        if (!rows.length) return;

        const layout = this._getCompositeLayout(x, barWidth);
        const maxRowVolume = Math.max(...rows.map(row => row.totalVolume), 1);
        const borderColor = candle.close >= candle.open ? 'rgba(0, 230, 118, 0.72)' : 'rgba(255, 82, 82, 0.72)';
        const bodyTop = Math.min(openY, closeY);
        const bodyBottom = Math.max(openY, closeY);
        const candleCenterX = layout.candleLeft + (layout.candleWidth / 2);
        const pocRow = rows.reduce((maxRow, row) => row.totalVolume > maxRow.totalVolume ? row : maxRow, rows[0]);

        this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.22)';
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(candleCenterX, highY);
        this.footprintCtx.lineTo(candleCenterX, lowY);
        this.footprintCtx.stroke();

        this.footprintCtx.fillStyle = candle.close >= candle.open
            ? 'rgba(0, 200, 83, 0.26)'
            : 'rgba(255, 23, 68, 0.26)';
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

        const dividerX = layout.footprintLeft + layout.footprintWidth * 0.5;
        this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.14)';
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(dividerX + 0.5, shellTop);
        this.footprintCtx.lineTo(dividerX + 0.5, shellBottom);
        this.footprintCtx.stroke();

        rows.forEach((row, index) => {
            const rowTop = index === 0 ? shellTop : rows[index - 1].boundaryBottom;
            const rowBottom = row.boundaryBottom;
            const rowHeight = Math.max(rowBottom - rowTop, 1);
            const sellIntensity = row.sellVolume > 0 ? 0.12 + (row.sellVolume / maxRowVolume) * 0.58 : 0;
            const buyIntensity = row.buyVolume > 0 ? 0.12 + (row.buyVolume / maxRowVolume) * 0.58 : 0;
            const dominantDelta = row.buyVolume - row.sellVolume;

            this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.05)';
            this.footprintCtx.lineWidth = 1;
            this.footprintCtx.beginPath();
            this.footprintCtx.moveTo(layout.footprintLeft, rowTop);
            this.footprintCtx.lineTo(layout.footprintRight, rowTop);
            this.footprintCtx.stroke();

            if (row.sellVolume > 0) {
                this.footprintCtx.fillStyle = `rgba(255, 23, 68, ${sellIntensity})`;
                this.footprintCtx.fillRect(layout.footprintLeft, rowTop, layout.footprintWidth / 2, rowHeight);
            }

            if (row.buyVolume > 0) {
                this.footprintCtx.fillStyle = `rgba(0, 200, 83, ${buyIntensity})`;
                this.footprintCtx.fillRect(dividerX, rowTop, layout.footprintWidth / 2, rowHeight);
            }

            if (Math.abs(dominantDelta) > maxRowVolume * 0.32) {
                this.footprintCtx.strokeStyle = dominantDelta >= 0
                    ? 'rgba(0, 230, 118, 0.35)'
                    : 'rgba(255, 82, 82, 0.35)';
                this.footprintCtx.lineWidth = 1;
                this.footprintCtx.strokeRect(
                    layout.footprintLeft + 0.5,
                    rowTop + 0.5,
                    Math.max(layout.footprintWidth - 1, 1),
                    Math.max(rowHeight - 1, 1)
                );
            }
        });

        if (pocRow && pocRow.totalVolume > 0) {
            const pocTop = pocRow.boundaryBottom - pocRow.height;
            this.footprintCtx.strokeStyle = 'rgba(255, 214, 0, 0.8)';
            this.footprintCtx.lineWidth = 1;
            this.footprintCtx.strokeRect(
                layout.footprintLeft + 0.5,
                pocTop + 0.5,
                Math.max(layout.footprintWidth - 1, 1),
                Math.max(pocRow.height - 1, 1)
            );
        }

        this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.18)';
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(layout.footprintLeft + 0.5, shellTop);
        this.footprintCtx.lineTo(layout.footprintLeft + 0.5, shellBottom);
        this.footprintCtx.stroke();

        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(layout.footprintRight - 0.5, shellTop);
        this.footprintCtx.lineTo(layout.footprintRight - 0.5, shellBottom);
        this.footprintCtx.stroke();

        const fontSize = layout.footprintWidth >= 52 ? 9 : layout.footprintWidth >= 34 ? 8 : 7;
        this.footprintCtx.font = `600 ${fontSize}px Inter, sans-serif`;
        this.footprintCtx.textBaseline = 'middle';

        rows.forEach(row => {
            if (layout.footprintWidth >= 30) {
                const bidAskLabel = `${this._formatFootprintValue(row.sellVolume)} x ${this._formatFootprintValue(row.buyVolume)}`;
                this.footprintCtx.fillStyle = row.buyVolume > row.sellVolume
                    ? '#e3fff0'
                    : row.sellVolume > row.buyVolume
                        ? '#ffe2e8'
                        : '#f3f5f7';
                this.footprintCtx.textAlign = 'center';
                this.footprintCtx.fillText(bidAskLabel, layout.footprintCenterX, row.y);
            } else if (row.totalVolume > 0) {
                this.footprintCtx.fillStyle = row.buyVolume >= row.sellVolume ? '#d8ffea' : '#ffd7df';
                this.footprintCtx.textAlign = 'center';
                this.footprintCtx.fillText(
                    this._formatFootprintValue(row.totalVolume),
                    layout.footprintCenterX,
                    row.y
                );
            }
        });
    }

    _getCompositeLayout(x, barWidth) {
        const totalWidth = Math.min(Math.max(barWidth * 0.98, 18), 86);
        const gap = totalWidth >= 28 ? 3 : 2;
        const candleWidth = Math.min(Math.max(totalWidth * 0.24, 4), 14);
        const footprintWidth = Math.max(totalWidth - candleWidth - gap, 10);
        const left = x - totalWidth / 2;
        const footprintLeft = left + candleWidth + gap;

        return {
            totalWidth,
            candleLeft: left,
            candleWidth,
            footprintLeft,
            footprintWidth,
            footprintRight: footprintLeft + footprintWidth,
            footprintCenterX: footprintLeft + (footprintWidth / 2)
        };
    }

    _drawDeltaLabel(footprint, x, barWidth) {
        if (!footprint || barWidth < 10) return;

        const delta = footprint.delta || 0;
        const label = this._formatSignedFootprintValue(delta);
        const labelWidth = Math.max(18, Math.min(62, barWidth * 1.7));
        const labelHeight = barWidth >= 18 ? 14 : 11;
        const left = x - labelWidth / 2;
        const stripHeight = Math.max(42, Math.min(68, this.height * 0.16));
        const top = this.height - stripHeight - labelHeight - 6;

        this.footprintCtx.fillStyle = 'rgba(8, 10, 16, 0.86)';
        this.footprintCtx.fillRect(left, top, labelWidth, labelHeight);

        const fontSize = Math.min(9, Math.max(6, barWidth * 0.28));
        this.footprintCtx.font = `600 ${fontSize}px Inter, sans-serif`;
        this.footprintCtx.textAlign = 'center';
        this.footprintCtx.textBaseline = 'middle';
        this.footprintCtx.fillStyle = delta > 0 ? '#00e676' : delta < 0 ? '#ff5252' : '#8b8b8f';
        this.footprintCtx.fillText(label, x, top + labelHeight / 2);
    }

    _drawBottomVolumetricStrip(visibleBars) {
        if (!visibleBars.length) return;

        const stripHeight = Math.max(42, Math.min(68, this.height * 0.16));
        const top = this.height - stripHeight;
        const rowCount = this.options.footprintStripRows || 4;
        const rowHeight = stripHeight / rowCount;
        const maxTotal = Math.max(...visibleBars.map(item => (item.footprint?.buyVolume || 0) + (item.footprint?.sellVolume || 0)), 1);
        const maxDelta = Math.max(...visibleBars.map(item => Math.abs(item.footprint?.delta || 0)), 1);

        this.footprintCtx.save();
        this.footprintCtx.fillStyle = 'rgba(9, 11, 16, 0.94)';
        this.footprintCtx.fillRect(0, top, this.width, stripHeight);
        this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.beginPath();
        this.footprintCtx.moveTo(0, top + 0.5);
        this.footprintCtx.lineTo(this.width, top + 0.5);
        this.footprintCtx.stroke();

        for (let row = 1; row < rowCount; row++) {
            const y = top + row * rowHeight;
            this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.06)';
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
        const legendWidth = 196;
        const legendHeight = 58;
        const x = 12;
        const y = 10;
        const currentDelta = latestFootprint?.delta ?? this.lastDelta ?? 0;
        const currentPrice = this.lastPrice ?? this.candleData[this.candleData.length - 1]?.close ?? null;

        this.footprintCtx.save();
        this.footprintCtx.fillStyle = 'rgba(11, 14, 22, 0.88)';
        this.footprintCtx.fillRect(x, y, legendWidth, legendHeight);
        this.footprintCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        this.footprintCtx.lineWidth = 1;
        this.footprintCtx.strokeRect(x + 0.5, y + 0.5, legendWidth - 1, legendHeight - 1);

        this.footprintCtx.font = '600 11px Inter, sans-serif';
        this.footprintCtx.textAlign = 'left';
        this.footprintCtx.textBaseline = 'top';
        this.footprintCtx.fillStyle = '#f3f5f7';
        this.footprintCtx.fillText('Value Footprint', x + 10, y + 8);

        this.footprintCtx.font = '500 9px Inter, sans-serif';
        this.footprintCtx.fillStyle = '#8b8b8f';
        this.footprintCtx.fillText('Candle left, bid x ask ladder right', x + 10, y + 24);

        this.footprintCtx.fillStyle = '#ffd600';
        this.footprintCtx.fillText(`Delta ${this._formatSignedFootprintValue(currentDelta)}`, x + 10, y + 39);

        if (currentPrice !== null) {
            this.footprintCtx.fillStyle = '#d8ffea';
            this.footprintCtx.fillText(`Last ${Number(currentPrice).toFixed(this.pricePrecision)}`, x + 102, y + 39);
        }

        this.footprintCtx.restore();
    }

    _buildFootprintRows(candle, footprint, highY, lowY) {
        const priceHigh = Number(candle.high);
        const priceLow = Number(candle.low);
        const range = Math.max(priceHigh - priceLow, Number.EPSILON);
        const shellHeight = Math.max(lowY - highY, 12);
        const desiredRows = Math.max(3, Math.min(12, Math.round(shellHeight / 14)));

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
        const levelsCount = Math.max(4, Math.min(10, Math.round(4 + Math.abs((candle.close - candle.open) / range) * 4 + Math.log10(volume + 1))));
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

        if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}K`;
        }

        if (value >= 100) {
            return value.toFixed(0);
        }

        if (value >= 10) {
            return value.toFixed(1);
        }

        return value.toFixed(2);
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
}
