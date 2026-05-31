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
        
        # Accounts and per-account state
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS account_state (
                account_id INTEGER PRIMARY KEY,
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS analysis_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL DEFAULT 1,
                ticker TEXT NOT NULL,
                pe REAL,
                price REAL,
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
        """)

        columns = [row[1] for row in cursor.execute("PRAGMA table_info(analysis_results)")]
        if "price" not in columns:
            cursor.execute("ALTER TABLE analysis_results ADD COLUMN price REAL")
        if "account_id" not in columns:
            cursor.execute("ALTER TABLE analysis_results ADD COLUMN account_id INTEGER DEFAULT 1")
            price_expr = "price" if "price" in columns else "NULL"
            cursor.execute("""
                CREATE TABLE analysis_results_tmp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL DEFAULT 1,
                    ticker TEXT NOT NULL,
                    pe REAL,
                    price REAL,
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
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
                )
            """)
            cursor.execute(f"""
                INSERT INTO analysis_results_tmp (
                    account_id, ticker, pe, price, eps_growth, revenue_growth, margin,
                    debt_equity, fcf_yield, sector, name, macro, fundamentals,
                    prospects, score, decision, reasons, created_at, updated_at
                )
                SELECT 1, ticker, pe, {price_expr}, eps_growth, revenue_growth, margin,
                    debt_equity, fcf_yield, sector, name, macro, fundamentals,
                    prospects, score, decision, reasons, created_at, updated_at
                FROM analysis_results
            """)
            cursor.execute("DROP TABLE analysis_results")
            cursor.execute("ALTER TABLE analysis_results_tmp RENAME TO analysis_results")
            columns = [row[1] for row in cursor.execute("PRAGMA table_info(analysis_results)")]

        # Purchased stocks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS purchased_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL DEFAULT 1,
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )
        """)
        columns = [row[1] for row in cursor.execute("PRAGMA table_info(purchased_stocks)")]
        if "account_id" not in columns:
            cursor.execute("ALTER TABLE purchased_stocks ADD COLUMN account_id INTEGER DEFAULT 1")
            cursor.execute("UPDATE purchased_stocks SET account_id = 1 WHERE account_id IS NULL")
        
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

        default_account_id = None
        cursor.execute("SELECT id FROM accounts ORDER BY id LIMIT 1")
        row = cursor.fetchone()
        if row:
            default_account_id = row[0]
        else:
            cursor.execute("INSERT INTO accounts (name) VALUES (?)", ("Default",))
            default_account_id = cursor.lastrowid

        cursor.execute("SELECT account_id FROM account_state WHERE account_id = ?", (default_account_id,))
        if not cursor.fetchone():
            cursor.execute("SELECT * FROM user_state WHERE id = 1")
            existing = cursor.fetchone()
            if existing:
                cursor.execute("""
                    INSERT OR REPLACE INTO account_state (
                        account_id, ticker_input, macro_rates, macro_inflation, macro_growth,
                        macro_risk, weight_macro, weight_fundamentals, weight_prospects,
                        active_tab, basket_sort, basket_config, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    default_account_id,
                    existing[1], existing[2], existing[3], existing[4], existing[5],
                    existing[6], existing[7], existing[8], existing[9], existing[10], existing[11]
                ))
        
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

    def get_account_id(self, parsed, body=None):
        params = parse_qs(parsed.query)
        account_id = params.get("account_id", [None])[0]
        if body and isinstance(body, dict):
            account_id = body.get("accountId") or body.get("account_id") or account_id
        try:
            return int(account_id)
        except (TypeError, ValueError):
            return 1

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/stocks":
            self.handle_stocks(parsed)
            return
        elif parsed.path == "/api/accounts":
            self.handle_list_accounts()
            return
        elif parsed.path == "/api/state":
            self.handle_load_state(parsed)
            return
        elif parsed.path == "/api/analysis":
            self.handle_load_analysis(parsed)
            return
        elif parsed.path == "/api/holdings":
            self.handle_load_holdings(parsed)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body_text = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        body = json.loads(body_text)
        
        if parsed.path == "/api/accounts":
            self.handle_create_account(body)
            return
        elif parsed.path == "/api/state":
            self.handle_save_state(parsed, body)
            return
        elif parsed.path == "/api/analysis":
            self.handle_save_analysis(parsed, body)
            return
        elif parsed.path == "/api/holdings":
            self.handle_save_holdings(parsed, body)
            return
        
        self.write_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "holdings":
            self.handle_delete_holding(parsed, path_parts[2])
            return
        if len(path_parts) == 3 and path_parts[0] == "api" and path_parts[1] == "accounts":
            self.handle_delete_account(path_parts[2])
            return
        self.write_json({"error": "Not found"}, 404)

    def handle_list_accounts(self):
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT id, name FROM accounts ORDER BY id")
            rows = cursor.fetchall()
            conn.close()

        accounts = [{"id": row["id"], "name": row["name"]} for row in rows]
        self.write_json({"accounts": accounts})

    def handle_create_account(self, data):
        name = str(data.get("name", "")).strip()
        if not name:
            self.write_json({"error": "Account name is required."}, 400)
            return

        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            try:
                cursor.execute("INSERT INTO accounts (name) VALUES (?)", (name,))
                account_id = cursor.lastrowid
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                self.write_json({"error": "An account with that name already exists."}, 400)
                return
            conn.close()

        self.write_json({"success": True, "account": {"id": account_id, "name": name}})

    def handle_delete_account(self, account_id_str):
        try:
            account_id = int(account_id_str)
        except ValueError:
            self.write_json({"error": "Invalid account id."}, 400)
            return

        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM accounts")
            total = cursor.fetchone()[0]
            if total <= 1:
                conn.close()
                self.write_json({"error": "At least one account must remain."}, 400)
                return

            cursor.execute("DELETE FROM account_state WHERE account_id = ?", (account_id,))
            cursor.execute("DELETE FROM analysis_results WHERE account_id = ?", (account_id,))
            cursor.execute("DELETE FROM purchased_stocks WHERE account_id = ?", (account_id,))
            cursor.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
            conn.commit()
            conn.close()

        self.write_json({"success": True})

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
        for symbol in symbols:
            try:
                stock = fetch_quote(symbol)
                stocks.append(stock)
                if stock.get("error"):
                    errors.append(f"{symbol}: {stock['error']}")
            except Exception as exc:
                errors.append(f"{symbol}: {exc}")
                stocks.append({"ticker": symbol, "error": "Online lookup failed.", "online": False})

        self.write_json({"stocks": stocks, "errors": errors})

    def handle_load_state(self, parsed):
        """Load user state (macro inputs, weights, active tab, etc.)"""
        account_id = self.get_account_id(parsed)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM account_state WHERE account_id = ?", (account_id,))
            row = cursor.fetchone()
            if not row and account_id == 1:
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

    def handle_save_state(self, parsed, data):
        """Save user state to database"""
        account_id = self.get_account_id(parsed, data)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            basket_config = json.dumps(data.get("baskets", []))
            cursor.execute("""
                INSERT OR REPLACE INTO account_state (
                    account_id, ticker_input, macro_rates, macro_inflation, macro_growth, macro_risk,
                    weight_macro, weight_fundamentals, weight_prospects, active_tab, 
                    basket_sort, basket_config, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (
                account_id,
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

    def handle_load_analysis(self, parsed):
        """Load all analysis results from database"""
        account_id = self.get_account_id(parsed)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM analysis_results WHERE account_id = ? ORDER BY score DESC", (account_id,))
            rows = cursor.fetchall()
            loaded_tickers = {row['ticker'] for row in rows}
            cursor.execute("SELECT DISTINCT ticker FROM purchased_stocks WHERE account_id = ?", (account_id,))
            holding_tickers = [row['ticker'] for row in cursor.fetchall()]
            missing_tickers = [ticker for ticker in holding_tickers if ticker not in loaded_tickers]
            for ticker in missing_tickers:
                cursor.execute("""
                    SELECT * FROM analysis_results
                    WHERE ticker = ? AND score IS NOT NULL
                    ORDER BY updated_at DESC, id DESC
                    LIMIT 1
                """, (ticker,))
                fallback = cursor.fetchone()
                if fallback:
                    rows.append(fallback)
            conn.close()
        
        results = []
        for row in rows:
            results.append({
                "ticker": row['ticker'],
                "pe": row['pe'],
                "price": row['price'],
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

    def handle_save_analysis(self, parsed, data):
        """Save analysis results to database"""
        account_id = self.get_account_id(parsed, data)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            if data.get("results") is None:
                cursor.execute("DELETE FROM analysis_results WHERE account_id = ?", (account_id,))
            else:
                cursor.execute("DELETE FROM analysis_results WHERE account_id = ?", (account_id,))
                for result in data.get("results", []):
                    cursor.execute("""
                        INSERT OR REPLACE INTO analysis_results (
                            account_id, ticker, pe, price, eps_growth, revenue_growth, margin, debt_equity, fcf_yield,
                            sector, name, macro, fundamentals, prospects, score, decision, reasons, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """, (
                        account_id,
                        result.get("ticker"),
                        result.get("pe"),
                        result.get("price"),
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

    def handle_load_holdings(self, parsed):
        """Load all purchased stocks from database"""
        account_id = self.get_account_id(parsed)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM purchased_stocks WHERE account_id = ? ORDER BY ticker ASC", (account_id,))
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

    def handle_save_holdings(self, parsed, data):
        """Save purchased stocks to database"""
        account_id = self.get_account_id(parsed, data)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            cursor.execute("DELETE FROM purchased_stocks WHERE account_id = ?", (account_id,))
            for holding in data.get("holdings", []):
                cursor.execute("""
                    INSERT INTO purchased_stocks (
                        account_id, ticker, shares, entry_price, target_price, stop_loss, basket,
                        source_idea, purchased_at, last_price, last_score, last_decision,
                        market_value, pnl, gain_loss_pct, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    account_id,
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

    def handle_delete_holding(self, parsed, ticker):
        """Delete a single purchased stock"""
        ticker = clean_symbol(ticker)
        account_id = self.get_account_id(parsed)
        with DB_LOCK:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM purchased_stocks WHERE ticker = ? AND account_id = ?", (ticker, account_id))
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
