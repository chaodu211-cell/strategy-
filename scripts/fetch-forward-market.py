#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch actual adjusted ETF closes; never fall back to unadjusted prices."""
import datetime as dt
import json
import math
import os
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ['QQQ', 'SOXX', 'QLD', 'TQQQ', 'USD', 'SOXL', 'PSQ', 'SQQQ', 'BIL']
NOW = dt.datetime.now(dt.timezone.utc)
START = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp())


def fetch(symbol):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/' + symbol +
           '?period1=' + str(START) + '&period2=' + str(int(NOW.timestamp())) +
           '&interval=1d&events=div%2Csplit')
    error = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as res:
                raw = json.load(res)['chart']['result'][0]
            quote = raw['indicators']['quote'][0]
            adj = raw['indicators']['adjclose'][0]['adjclose']
            result = {}
            for i, stamp in enumerate(raw['timestamp']):
                date = dt.datetime.fromtimestamp(stamp, ZoneInfo('America/New_York')).date()
                # Reject live/partial bars, including early-close days (conservative 16:00 cutoff).
                close_at = dt.datetime.combine(date, dt.time(16), ZoneInfo('America/New_York'))
                if close_at.astimezone(dt.timezone.utc) + dt.timedelta(minutes=30) > NOW:
                    continue
                a, c, v = adj[i], quote['close'][i], quote['volume'][i]
                if a is None or c is None or v is None or not all(math.isfinite(x) for x in [a, c, v]) or min(a, c) <= 0:
                    continue
                result[str(date)] = {'adjclose': a, 'close': c, 'volume': v, 'closeAt': close_at.isoformat()}
            if len(result) < 280:
                raise ValueError(symbol + ' warmup is incomplete')
            return symbol, result
        except Exception as exc:
            error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(symbol + ': ' + str(error))


def main():
    with ThreadPoolExecutor(max_workers=3) as pool:
        series = dict(pool.map(fetch, SYMBOLS))
    dates = sorted(series['QQQ'])
    rows = []
    for i, date in enumerate(dates):
        prices, tradable, costs = {}, {}, {}
        for symbol in SYMBOLS:
            source = series[symbol]
            if date not in source:
                raise ValueError(date + ' missing ' + symbol)
            bar = source[date]
            prices[symbol] = bar['adjclose']
            prior = [source[d]['close'] * source[d]['volume'] for d in dates[max(0, i-60):i] if d in source]
            adv = sum(prior) / len(prior) if len(prior) >= 20 else 0
            tradable[symbol] = symbol == 'BIL' or (i >= 20 and dates[i-20] in source and adv >= 1e7)
            costs[symbol] = 1e-4 if symbol == 'BIL' else 3e-4 if adv >= 5e8 else 8e-4 if adv >= 5e7 else 20e-4
        rows.append({'date': date, 'prices': prices, 'tradable': tradable, 'costs': costs,
                     'closeAt': series['QQQ'][date]['closeAt'], 'priceBasis': 'adjusted'})
    result = {'schemaVersion': 1, 'priceBasis': 'adjusted', 'as_of': dates[-1],
              'fetchedAt': NOW.isoformat(), 'health': {'ok': True}, 'provider': 'Yahoo Finance chart adjclose', 'rows': rows}
    target = ROOT / '.runtime' / 'market.json'
    target.parent.mkdir(exist_ok=True)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    os.replace(temp, target)
    print(json.dumps({'marketDate': dates[-1], 'days': len(dates), 'symbols': len(SYMBOLS)}))


if __name__ == '__main__':
    main()
