# Stock Conviction Analyzer

A browser app for screening a list of stocks against three decision pillars:

- Macro backdrop
- Fundamental quality
- Company prospects

Run the local server and paste comma-separated tickers on one line.

```sh
python3 server.py
```

Then open `http://127.0.0.1:8020`.

CSV format:

```text
ticker, P/E, EPS growth %, revenue growth %, margin %, debt/equity, FCF yield %, prospects 1-10
```

Example:

```text
AAPL,28,7,5,31,1.6,3.4,8
MSFT,34,12,13,36,0.4,2.6,9
```

The app uses transparent scoring heuristics and does not provide financial advice. Online stock data is loaded through the local `/api/stocks` endpoint from public StockAnalysis pages.

## Purchased Stocks

Use the purchased stocks panel to store stock, qty, purchase price, stop loss, target, basket, and source idea. Purchased assets are grouped by basket in the sidebar. The monitor checks owned stocks against live public data while the app is open, flags target/stop hits, watches for major score or analyst-rating changes, and suggests `Review Sell`, `Take Profit`, `Hold / Add`, or `Hold`.

The monitor refreshes every five minutes while the page is open. You can also click `Refresh Holdings`.
