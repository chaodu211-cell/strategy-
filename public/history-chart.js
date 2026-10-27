/* Shared pure chart presentation helpers: no network or model calculation. */
(function (root) {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = n => `${(n * 100).toFixed(2)}%`;
  const multiple = n => `${Number(n).toFixed(2)}×`;
  const symbolName = symbol => symbol.startsWith('SYN_') ? `${symbol.slice(4)}（合成）` : symbol;
  function nearestIndex(points, timestamp) {
    if (!points.length) return -1;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(points[mid].date) < timestamp) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    return timestamp - Date.parse(points[lo - 1].date) <= Date.parse(points[lo].date) - timestamp ? lo - 1 : lo;
  }
  function mergeLandmarks(series, drawdown) {
    if (!drawdown) return series;
    const dates = new Map(series.map(p => [p.date, p]));
    dates.set(drawdown.peakDate, {...dates.get(drawdown.peakDate), date:drawdown.peakDate, nav:drawdown.peakNav});
    dates.set(drawdown.troughDate, {...dates.get(drawdown.troughDate), date:drawdown.troughDate, nav:drawdown.troughNav});
    return [...dates.values()].sort((a,b) => a.date.localeCompare(b.date));
  }
  function tooltipHTML(point, benchmarkValue, detail, drawdown, loadState,annotationHTML='') {
    const landmark = point.date === drawdown?.troughDate ? '最大回撤谷底' : point.date === drawdown?.peakDate ? '最大回撤起点' : '';
    let html = `<div class="hover-heading"><strong>${escape(point.date)}</strong>${landmark ? `<em>${landmark}</em>` : ''}</div><div class="hover-nav"><span>策略净值 <b>${multiple(point.value)}</b></span><span>QQQ <b>${multiple(benchmarkValue)}</b></span></div>`;
    html += annotationHTML;
    if (!detail) return html + `<p class="hover-note">${loadState === 'error' ? '历史持仓明细加载失败，可重试刷新页面。' : '正在加载历史持仓明细…'}</p>`;
    html += `<div class="hover-position-title"><span>回测收盘持仓</span><b>${escape(detail.state)}</b></div><div class="hover-holdings">`;
    for (const [symbol, weight] of [...detail.holdings, [detail.cash<0?'融资负债':'BIL', detail.cash]]) {
      html += `<div><span>${escape(symbolName(symbol))}</span><strong>${percent(weight)}</strong></div>`;
    }
    html += `</div><div class="hover-exposure">底层敞口 <strong>${multiple(detail.exposure)}</strong></div>`;
    const target = [...detail.targetHoldings, [detail.targetCash<0?'融资负债':'BIL',detail.targetCash]].map(([s,w]) => `${symbolName(s)} ${percent(w)}`).join(' / ');
    html += `<div class="hover-target">规则目标：${escape(target)}</div><div class="hover-basis-title">信号依据 · ${escape(detail.signalDate)}</div><ul class="hover-reasons">${detail.reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul>`;
    const band=Number.isFinite(detail.band)?Number((detail.band*100).toFixed(4)):5;
    html += `<p class="hover-note">${detail.rebalanced ? '当日收盘已按前一交易日信号再平衡。' : `未触发${band}个百分点再平衡带，权重可能随价格浮动。`}<br>回测模拟持仓，非账户实盘持仓。</p>`;
    return html;
  }
  root.HistoryChart = Object.freeze({nearestIndex, mergeLandmarks, tooltipHTML});
})(window);
