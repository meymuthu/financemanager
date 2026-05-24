from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import math
import os
import re
import ssl
import sqlite3
from datetime import datetime
import threading


PORT = int(os.environ.get("PORT", "8020"))
HOST = "127.0.0.1"
SSL_CONTEXT = ssl._create_unverified_context()
DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")
DB_LOCK = threading.Lock()


SECTOR_PROFILES = {
    "Technology": {"moat": 8, "sensitivity": 6},
    "Communication Services": {"moat": 7, "sensitivity": 6},
    "Consumer Cyclical": {"moat": 6, "sensitivity": 8},
    "Consumer Defensive": {"moat": 6, "sensitivity": 4},
    "Financial Services": {"moat": 6, "sensitivity": 6},
    "Healthcare": {"moat": 7, "sensitivity": 4},
    "Industrials": {"moat": 6, "sensitivity": 6},
    "Energy": {"moat": 6, "sensitivity": 5},
    "Utilities": {"moat": 5, "sensitivity": 5},
    "Real Estate": {"moat": 4, "sensitivity": 8},
    "Basic Materials": {"moat": 5, "sensitivity": 7},
}


def clean_symbol(value):
    return "".join(ch for ch in value.upper().strip() if ch.isalpha() or ch in ".-")[:8]


def safe_read(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=12, context=SSL_CONTEXT) as response:
        return response.read().decode("utf-8")


def raw_value(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return value
    if isinstance(value, str):
        return parse_number(value)
    return None


def percent_value(value):
    raw = raw_value(value)
    if raw is None:
        return None
    return round(raw * 100, 2)


def parse_number(value):
    if value is None:
        return None
    text = str(value).strip().replace("$", "").replace(",", "").replace("+", "")
    if not text or text.lower() == "n/a":
        return None
    multiplier = 1
    if text.endswith("%"):
        text = text[:-1]
    elif text.endswith("T"):
        text = text[:-1]
        multiplier = 1_000_000_000_000
    elif text.endswith("B"):
        text = text[:-1]
        multiplier = 1_000_000_000
    elif text.endswith("M"):
        text = text[:-1]
        multiplier = 1_000_000
    elif text.endswith("K"):
        text = text[:-1]
        multiplier = 1_000
    try:
        return round(float(text) * multiplier, 4)
    except ValueError:
        return None


def extract_value(html, metric_id):
    pattern = rf'id:"{re.escape(metric_id)}",title:"[^"]+",value:"([^"]+)"'
    match = re.search(pattern, html)
    if not match:
        return None
    return match.group(1)


def extract_string(html, name):
    match = re.search(rf'{re.escape(name)}:"([^"]*)"', html)
    return match.group(1) if match else None


def extract_price(html):
    match = re.search(r"quote:\{.*?p:([-0-9.]+)", html)
    return float(match.group(1)) if match else None


def score_prospects(sector, earnings_growth, revenue_growth, recommendation_mean, target_upside):
    profile = SECTOR_PROFILES.get(sector or "", {"moat": 5})
    score = profile["moat"] * 8
    if earnings_growth is not None:
        score += max(-15, min(25, earnings_growth)) * 0.6
    if revenue_growth is not None:
        score += max(-10, min(35, revenue_growth)) * 0.5
    if recommendation_mean is not None:
        score += max(-10, min(12, (3 - recommendation_mean) * 6))
    if target_upside is not None:
        score += max(-8, min(12, target_upside * 0.25))
    return max(1, min(10, round(score / 10, 1)))


def init_db():
    """Initialize SQLite database with analysis results and purchased stocks tables."""
    with DB_LOCK:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Analysis results table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS analysis_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE NOT NULL,
                pe REAL,
                eps_growth REAL,
                revenue_growth REAL,
                margin REAL,
                debt_equity REAL,
                fcf_yield REAL,
                sector TEXT,
                name TEXT,
                macro INTEGER,
                fundamentals INTEGER,
                prospects INTEGER,
                score INTEGER,
                decision TEXT,
                reasons TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Purchased stocks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS purchased_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                shares REAL NOT NULL,
                entry_price REAL NOT NULL,
                target_price REAL,
                stop_loss REAL,
                basket TEXT DEFAULT 'General',
                source_idea TEXT,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_price REAL,
                last_score INTEGER,
                last_decision TEXT,
                market_value REAL,
                pnl REAL,
                gain_loss_pct REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # User state table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                ticker_input TEXT,
                macro_rates INTEGER DEFAULT 25,
                macro_inflation INTEGER DEFAULT 20,
                macro_growth INTEGER DEFAULT 25,
                macro_risk INTEGER DEFAULT 13,
                weight_macro INTEGER DEFAULT 25,
                weight_fundamentals INTEGER DEFAULT 45,
                weight_prospects INTEGER DEFAULT 30,
                active_tab TEXT DEFAULT 'analyzer',
                basket_sort TEXT DEFAULT 'value-desc',
                basket_config TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
        conn.close()




def fetch_quote(symbol):
    slug = symbol.lower().replace(".", "-")
    stats_html = safe_read(f"https://stockanalysis.com/stocks/{slug}/statistics/")
    company_html = safe_read(f"https://stockanalysis.com/stocks/{slug}/company/")

    current_price = extract_price(stats_html)
    market_cap = parse_number(extract_value(stats_html, "marketcap"))
    pe = parse_number(extract_value(stats_html, "peForward")) or parse_number(extract_value(stats_html, "pe"))
    earnings_growth = parse_number(extract_value(stats_html, "eps5y"))
    revenue_growth = parse_number(extract_value(stats_html, "revenue5y"))
    margin = parse_number(extract_value(stats_html, "profitMargin"))
    debt_equity = parse_number(extract_value(stats_html, "debtEquity"))
    fcf_yield = parse_number(extract_value(stats_html, "fcfYield"))
    target_upside = parse_number(extract_value(stats_html, "priceTargetChange"))
    rating = extract_value(stats_html, "analystRatings")
    name = extract_string(stats_html, "nameFull") or extract_string(company_html, "nameFull") or symbol
    sector = None
    sector_match = re.search(r"sector:\{value:\"([^\"]+)\"", company_html)
    if sector_match:
        sector = sector_match.group(1)
    industry = None
    industry_match = re.search(r"industry:\{value:\"([^\"]+)\"", company_html)
    if industry_match:
        industry = industry_match.group(1)

    prospect_score = score_prospects(
        sector,
        earnings_growth,
        revenue_growth,
        None,
        target_upside,
    )

    return {
        "ticker": symbol,
        "name": name,
        "sector": sector or "Unclassified",
        "industry": industry or "",
        "price": current_price,
        "marketCap": market_cap,
        "pe": pe,
        "epsGrowth": earnings_growth,
        "revenueGrowth": revenue_growth,
        "margin": margin,
        "debtEquity": debt_equity,
        "fcfYield": fcf_yield,
        "prospectScore": prospect_score,
        "analystRating": rating,
        "targetUpside": target_upside,
        "online": True,
    }


class StockHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/stocks":
            self.handle_stocks(parsed)
            return
        elif parsed.path == "/api/state":
            self.handle_load_state()
            return
        elif parsed.path == "/api/analysis":
            self.handle_load_analysis()
            return
        elif parsed.path == "/api/holdings":
            self.handle_load_holdings()
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        
        if parsed.path == "/api/state":
            self.handle_save_state(json.loads(body))
            return
        elif parsed.path == "/api/analysis":
            self.handle_save_analysis(json.loads(body))
            return
        elif parsed.path == "/api/holdings":
            self.handle_save_holdings(json.loads(body))
            return
        
        self.write_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "holdings":
            self.handle_delete_holding(path_parts[2])
            return
        self.write_json({"error": "Not found"}, 404)

    def handle_stocks(self, parsed):
        params = parse_qs(parsed.query)
        symbols = [
            clean_symbol(symbol)
            for symbol in ",".join(params.get("symbols", [])).replace("\n", ",").split(",")
        ]
        symbols = list(dict.fromkeys(symbol for symbol in symbols if symbol))
        if not symbols:
            self.write_json({"stocks": [], "errors": ["No symbols provided."]}, 400)
            return

        stocks = []
        errors = []
        for symbol in symbols[:25]:
            try:
                stock = fetch_quote(symbol)
                stocks.append(stock)
                if stock.get("error"):
                    errors.append(f"{symbol}: {stock['error']}")
            except Exception as exc:
                errors.append(f"{symbol}: {exc}")
                stocks.append({"ticker": symbol, "error": "Online lookup failed.", "online": False})

        self.write_json({"stocks": stocks, "errors": errors})

    def handle_load_state(self):
        """Load user state (macro inputs, weights, active tab, etc.)"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM user_state WHERE id = 1")
            row = cursor.fetchone()
            conn.close()
        
        if row:
            basket_config = json.loads(row['basket_config']) if row['basket_config'] else []
            state = {
                "tickerInput": row['ticker_input'] or "",
                "macro": {
                    "rates": row['macro_rates'],
                    "inflation": row['macro_inflation'],
                    "growth": row['macro_growth'],
                    "risk": row['macro_risk']
                },
                "weights": {
                    "macro": row['weight_macro'],
                    "fundamentals": row['weight_fundamentals'],
                    "prospects": row['weight_prospects']
                },
                "activeTab": row['active_tab'],
                "basketSort": row['basket_sort'],
                "baskets": basket_config
            }
            self.write_json(state)
        else:
            self.write_json({
                "tickerInput": "",
                "macro": {"rates": 25, "inflation": 20, "growth": 25, "risk": 13},
                "weights": {"macro": 25, "fundamentals": 45, "prospects": 30},
                "activeTab": "analyzer",
                "basketSort": "value-desc",
                "baskets": []
            })

    def handle_save_state(self, data):
        """Save user state to database"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            basket_config = json.dumps(data.get("baskets", []))
            cursor.execute("""
                INSERT OR REPLACE INTO user_state (
                    id, ticker_input, macro_rates, macro_inflation, macro_growth, macro_risk,
                    weight_macro, weight_fundamentals, weight_prospects, active_tab, 
                    basket_sort, basket_config, updated_at
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                data.get("tickerInput", ""),
                data.get("macro", {}).get("rates", 25),
                data.get("macro", {}).get("inflation", 20),
                data.get("macro", {}).get("growth", 25),
                data.get("macro", {}).get("risk", 13),
                data.get("weights", {}).get("macro", 25),
                data.get("weights", {}).get("fundamentals", 45),
                data.get("weights", {}).get("prospects", 30),
                data.get("activeTab", "analyzer"),
                data.get("basketSort", "value-desc"),
                basket_config
            ))
            conn.commit()
            conn.close()
        
        self.write_json({"success": True})

    def handle_load_analysis(self):
        """Load all analysis results from database"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM analysis_results ORDER BY score DESC")
            rows = cursor.fetchall()
            conn.close()
        
        results = []
        for row in rows:
            results.append({
                "ticker": row['ticker'],
                "pe": row['pe'],
                "epsGrowth": row['eps_growth'],
                "revenueGrowth": row['revenue_growth'],
                "margin": row['margin'],
                "debtEquity": row['debt_equity'],
                "fcfYield": row['fcf_yield'],
                "sector": row['sector'],
                "name": row['name'],
                "macro": row['macro'],
                "fundamentals": row['fundamentals'],
                "prospects": row['prospects'],
                "score": row['score'],
                "decision": row['decision'],
                "reasons": json.loads(row['reasons']) if row['reasons'] else [],
                "online": True
            })
        
        self.write_json({"analysis": results})

    def handle_save_analysis(self, data):
        """Save analysis results to database"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            if data.get("results") is None:
                cursor.execute("DELETE FROM analysis_results")
            else:
                cursor.execute("DELETE FROM analysis_results")
                for result in data.get("results", []):
                    cursor.execute("""
                        INSERT OR REPLACE INTO analysis_results (
                            ticker, pe, eps_growth, revenue_growth, margin, debt_equity, fcf_yield,
                            sector, name, macro, fundamentals, prospects, score, decision, reasons, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """, (
                        result.get("ticker"),
                        result.get("pe"),
                        result.get("epsGrowth"),
                        result.get("revenueGrowth"),
                        result.get("margin"),
                        result.get("debtEquity"),
                        result.get("fcfYield"),
                        result.get("sector"),
                        result.get("name"),
                        result.get("macro"),
                        result.get("fundamentals"),
                        result.get("prospects"),
                        result.get("score"),
                        result.get("decision"),
                        json.dumps(result.get("reasons", []))
                    ))

            conn.commit()
            conn.close()

        self.write_json({"success": True})

    def handle_load_holdings(self):
        """Load all purchased stocks from database"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM purchased_stocks ORDER BY ticker ASC")
            rows = cursor.fetchall()
            conn.close()
        
        holdings = []
        for row in rows:
            holdings.append({
                "ticker": row['ticker'],
                "shares": row['shares'],
                "entryPrice": row['entry_price'],
                "targetPrice": row['target_price'],
                "stopLoss": row['stop_loss'],
                "basket": row['basket'],
                "sourceIdea": row['source_idea'],
                "purchasedAt": row['purchased_at'],
                "lastPrice": row['last_price'],
                "lastScore": row['last_score'],
                "lastDecision": row['last_decision'],
                "marketValue": row['market_value'],
                "pnl": row['pnl'],
                "gainLossPct": row['gain_loss_pct']
            })
        
        self.write_json({"holdings": holdings})

    def handle_save_holdings(self, data):
        """Save purchased stocks to database"""
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            cursor.execute("DELETE FROM purchased_stocks")
            for holding in data.get("holdings", []):
                cursor.execute("""
                    INSERT INTO purchased_stocks (
                        ticker, shares, entry_price, target_price, stop_loss, basket,
                        source_idea, purchased_at, last_price, last_score, last_decision,
                        market_value, pnl, gain_loss_pct, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    holding.get("ticker"),
                    holding.get("shares"),
                    holding.get("entryPrice"),
                    holding.get("targetPrice"),
                    holding.get("stopLoss"),
                    holding.get("basket", "General"),
                    holding.get("sourceIdea"),
                    holding.get("purchasedAt"),
                    holding.get("lastPrice"),
                    holding.get("lastScore"),
                    holding.get("lastDecision"),
                    holding.get("marketValue"),
                    holding.get("pnl"),
                    holding.get("gainLossPct")
                ))

            conn.commit()
            conn.close()

        self.write_json({"success": True})

    def handle_delete_holding(self, ticker):
        """Delete a single purchased stock"""
        ticker = clean_symbol(ticker)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM purchased_stocks WHERE ticker = ?", (ticker,))
            conn.commit()
            conn.close()
        self.write_json({"success": True})

    def write_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)



if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DB_PATH}")
    server = ThreadingHTTPServer((HOST, PORT), StockHandler)
    print(f"Serving stock analyzer on http://{HOST}:{PORT}")
    server.serve_forever()
