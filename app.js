const sampleRows = [
  "AAPL,28,7,5,31,1.6,3.4,8",
  "MSFT,34,12,13,36,0.4,2.6,9",
  "NVDA,52,28,45,55,0.2,1.7,10",
  "JPM,12,6,4,29,1.1,6.2,7",
  "T,17,2,1,14,1.8,8.8,4",
  "RIVN,,18,32,-8,0.5,-12,6"
];

const state = {
  stocks: [],
  results: [],
  holdings: [],
  baskets: [
    { id: "b-general", name: "General", description: "Default stock holdings", color: "slate" },
    { id: "b-ai-tech", name: "AI & Tech", description: "Artificial intelligence and software leaders", color: "emerald" },
    { id: "b-dividend", name: "Income Dividends", description: "High yielding defensive stocks", color: "sapphire" }
  ],
  basketExpanded: {}, // map of basket name -> boolean
  activeTab: "analyzer", // "analyzer" or "portfolio"
  editingHoldingTicker: null, // ticker being edited inline
  basketSort: "value-desc", // sort mode
  recommendations: [],
  monitorAlerts: [],
  lastMonitorTime: null,
  onlineErrors: [],
  filter: "all",
  selectedTicker: null
};

const elements = {
  // Navigation
  tabAnalyzer: document.getElementById("tabAnalyzer"),
  tabPortfolio: document.getElementById("tabPortfolio"),
  analyzerPage: document.getElementById("analyzerPage"),
  portfolioPage: document.getElementById("portfolioPage"),

  // Original Sidebar Elements
  tickerInput: document.getElementById("tickerInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  exportBtn: document.getElementById("exportBtn"),
  clearBtn: document.getElementById("clearBtn"),
  holdingTickerInput: document.getElementById("holdingTickerInput"),
  sharesInput: document.getElementById("sharesInput"),
  entryPriceInput: document.getElementById("entryPriceInput"),
  targetPriceInput: document.getElementById("targetPriceInput"),
  stopLossInput: document.getElementById("stopLossInput"),
  basketInput: document.getElementById("basketInput"),
  basketDatalist: document.getElementById("basketDatalist"),
  quickAddForm: document.getElementById("quickAddForm"),
  qaNewBasketBtn: document.getElementById("qaNewBasketBtn"),
  sourceIdeaInput: document.getElementById("sourceIdeaInput"),
  addHoldingBtn: document.getElementById("addHoldingBtn"),
  monitorBtn: document.getElementById("monitorBtn"),
  holdingsList: document.getElementById("holdingsList"),
  holdingCount: document.getElementById("holdingCount"),
  
  // Original Dashboard Elements
  monitorHeadline: document.getElementById("monitorHeadline"),
  monitorAlerts: document.getElementById("monitorAlerts"),
  lastMonitorTime: document.getElementById("lastMonitorTime"),
  replacementHeadline: document.getElementById("replacementHeadline"),
  replacementList: document.getElementById("replacementList"),
  resultsBody: document.getElementById("resultsBody"),
  detailContent: document.getElementById("detailContent"),
  buyCount: document.getElementById("buyCount"),
  watchCount: document.getElementById("watchCount"),
  avoidCount: document.getElementById("avoidCount"),
  averageScore: document.getElementById("averageScore"),
  ratesInput: document.getElementById("ratesInput"),
  inflationInput: document.getElementById("inflationInput"),
  growthInput: document.getElementById("growthInput"),
  riskInput: document.getElementById("riskInput"),
  macroWeight: document.getElementById("macroWeight"),
  fundamentalWeight: document.getElementById("fundamentalWeight"),
  prospectWeight: document.getElementById("prospectWeight"),
  macroWeightValue: document.getElementById("macroWeightValue"),
  fundamentalWeightValue: document.getElementById("fundamentalWeightValue"),
  prospectWeightValue: document.getElementById("prospectWeightValue"),

  // Portfolio Hub Specific Elements
  totalPortfolioValue: document.getElementById("totalPortfolioValue"),
  totalPortfolioCost: document.getElementById("totalPortfolioCost"),
  totalPortfolioPnl: document.getElementById("totalPortfolioPnl"),
  totalPortfolioScore: document.getElementById("totalPortfolioScore"),
  newBasketBtn: document.getElementById("newBasketBtn"),
  refreshPortfolioBtn: document.getElementById("refreshPortfolioBtn"),
  basketSortSelect: document.getElementById("basketSortSelect"),
  basketGrid: document.getElementById("basketGrid"),
  loadStatus: document.getElementById("loadStatus"),

  // Basket CRUD Modal Elements
  basketModal: document.getElementById("basketModal"),
  modalTitle: document.getElementById("modalTitle"),
  basketForm: document.getElementById("basketForm"),
  editBasketId: document.getElementById("editBasketId"),
  modalBasketName: document.getElementById("modalBasketName"),
  modalBasketDesc: document.getElementById("modalBasketDesc"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  cancelModalBtn: document.getElementById("cancelModalBtn"),
  saveBasketBtn: document.getElementById("saveBasketBtn")
};

const sectorProfiles = {
  AAPL: { sector: "Consumer Technology", moat: 9, sensitivity: 6 },
  MSFT: { sector: "Software", moat: 9, sensitivity: 5 },
  NVDA: { sector: "Semiconductors", moat: 8, sensitivity: 8 },
  AMZN: { sector: "Consumer Internet", moat: 8, sensitivity: 7 },
  GOOGL: { sector: "Digital Advertising", moat: 8, sensitivity: 6 },
  META: { sector: "Digital Advertising", moat: 7, sensitivity: 7 },
  TSLA: { sector: "Autos", moat: 6, sensitivity: 9 },
  JPM: { sector: "Banking", moat: 7, sensitivity: 6 },
  BAC: { sector: "Banking", moat: 6, sensitivity: 7 },
  XOM: { sector: "Energy", moat: 6, sensitivity: 5 },
  CVX: { sector: "Energy", moat: 6, sensitivity: 5 },
  T: { sector: "Telecom", moat: 4, sensitivity: 4 }
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function setLoadStatus(message, tone = "info") {
  if (!elements.loadStatus) {
    return;
  }
  elements.loadStatus.textContent = message;
  elements.loadStatus.dataset.tone = tone;
}

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStocks(rawText) {
  return rawText
    .split(/\n|;/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const cells = trimmed.split(",").map((cell) => cell.trim()).filter(Boolean);
      if (cells.length === 1 && /\s/.test(cells[0])) {
        return cells[0].split(/\s+/).map((ticker) => ({ ticker: normalizeTicker(ticker) }));
      }
      if (cells.length === 1) return [{ ticker: normalizeTicker(cells[0]) }];
      if (cells.every((cell) => /^[A-Za-z. -]{1,8}$/.test(cell))) {
        return cells.map((ticker) => ({ ticker: normalizeTicker(ticker) }));
      }
      return [{
        ticker: normalizeTicker(cells[0]),
        pe: parseNumber(cells[1]),
        epsGrowth: parseNumber(cells[2]),
        revenueGrowth: parseNumber(cells[3]),
        margin: parseNumber(cells[4]),
        debtEquity: parseNumber(cells[5]),
        fcfYield: parseNumber(cells[6]),
        prospectScore: parseNumber(cells[7])
      }];
    })
    .filter((stock) => stock.ticker)
    .filter((stock, index, stocks) => stocks.findIndex((item) => item.ticker === stock.ticker) === index);
}

function shouldFetchOnline(rawText) {
  const cleaned = rawText.trim();
  if (!cleaned) return false;
  const oneLine = !/[\n;]/.test(cleaned);
  const cells = cleaned.split(",").map((cell) => cell.trim()).filter(Boolean);
  return oneLine && cells.length > 0 && cells.every((cell) => /^[A-Za-z. -]{1,8}$/.test(cell));
}

async function fetchOnlineStocks(rawText) {
  const symbols = parseStocks(rawText).map((stock) => stock.ticker);
  if (!symbols.length) return { stocks: [], errors: [] };
  const response = await fetch(`/api/stocks?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (!response.ok) throw new Error("Online stock lookup failed.");
  return response.json();
}

function parseHoldingInput() {
  const ticker = normalizeTicker(elements.holdingTickerInput.value);
  const shares = parseNumber(elements.sharesInput.value);
  const entryPrice = parseNumber(elements.entryPriceInput.value);
  const targetPrice = parseNumber(elements.targetPriceInput.value);
  const stopLoss = parseNumber(elements.stopLossInput.value);
  const basketName = elements.basketInput.value.trim();
  const basket = basketName || "General";
  const sourceIdea = elements.sourceIdeaInput.value.trim();
  if (!ticker || shares === null || shares <= 0 || entryPrice === null || entryPrice <= 0) return null;
  
  // Auto-create basket in state if it's new
  ensureBasketExists(basket);
  
  return {
    ticker,
    shares: Number(shares.toFixed(4)),
    entryPrice: Number(entryPrice.toFixed(2)),
    targetPrice: targetPrice && targetPrice > 0 ? Number(targetPrice.toFixed(2)) : null,
    stopLoss: stopLoss && stopLoss > 0 ? Number(stopLoss.toFixed(2)) : null,
    basket,
    sourceIdea,
    purchasedAt: new Date().toISOString()
  };
}

function ensureBasketExists(basketName) {
  const nameLower = basketName.toLowerCase();
  const exists = state.baskets.some((b) => b.name.toLowerCase() === nameLower);
  if (!exists) {
    const colors = ["emerald", "sapphire", "amethyst", "amber", "ruby", "slate"];
    const randomColor = colors[state.baskets.length % colors.length];
    state.baskets.push({
      id: "b-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      name: basketName,
      description: "Auto-created basket for " + basketName,
      color: randomColor
    });
    updateBasketDatalist();
  }
}

function normalizeTicker(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z.-]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

function macroScore(stock) {
  const base = [
    Number(elements.ratesInput.value),
    Number(elements.inflationInput.value),
    Number(elements.growthInput.value),
    Number(elements.riskInput.value)
  ].reduce((sum, value) => sum + value, 0);
  const profile = getProfile(stock);
  const riskPenalty = (profile.sensitivity - 5) * 2.4;
  return clamp(base - riskPenalty);
}

function getProfile(stock) {
  if (stock.sector && stock.sector !== "Unclassified") {
    const sectorSensitivity = {
      Technology: 6,
      "Communication Services": 6,
      "Consumer Cyclical": 8,
      "Consumer Defensive": 4,
      "Financial Services": 6,
      Healthcare: 4,
      Industrials: 6,
      Energy: 5,
      Utilities: 5,
      "Real Estate": 8,
      "Basic Materials": 7
    };
    const sectorMoat = {
      Technology: 8,
      "Communication Services": 7,
      "Consumer Cyclical": 6,
      "Consumer Defensive": 6,
      "Financial Services": 6,
      Healthcare: 7,
      Industrials: 6,
      Energy: 6,
      Utilities: 5,
      "Real Estate": 4,
      "Basic Materials": 5
    };
    return {
      sector: stock.sector,
      sensitivity: sectorSensitivity[stock.sector] ?? 6,
      moat: sectorMoat[stock.sector] ?? 5
    };
  }
  return sectorProfiles[stock.ticker] ?? { sector: "Unclassified", moat: 5, sensitivity: 6 };
}

function valuationScore(pe) {
  if (pe == null) return 48;
  if (pe <= 0) return 20;
  if (pe <= 12) return 92;
  if (pe <= 20) return 78;
  if (pe <= 30) return 62;
  if (pe <= 45) return 46;
  return 28;
}

function growthScore(epsGrowth, revenueGrowth) {
  const eps = epsGrowth == null ? 7 : epsGrowth;
  const revenue = revenueGrowth == null ? 6 : revenueGrowth;
  return clamp(42 + eps * 1.2 + revenue * 1.1);
}

function qualityScore(stock) {
  const margin = stock.margin == null ? 18 : stock.margin;
  const debt = stock.debtEquity == null ? 0.9 : stock.debtEquity;
  const normalizedDebt = debt > 20 ? debt / 100 : debt;
  const fcf = stock.fcfYield == null ? 3 : stock.fcfYield;
  return clamp(36 + margin * 0.9 + fcf * 3.2 - normalizedDebt * 9);
}

function fundamentalScore(stock) {
  return clamp(
    valuationScore(stock.pe) * 0.33 +
    growthScore(stock.epsGrowth, stock.revenueGrowth) * 0.34 +
    qualityScore(stock) * 0.33
  );
}

function prospectScore(stock) {
  const profile = getProfile(stock);
  const userScore = stock.prospectScore == null ? profile.moat : stock.prospectScore;
  const growthTilt = stock.revenueGrowth == null ? 0 : clamp(stock.revenueGrowth, -10, 35) * 0.7;
  return clamp(userScore * 8 + growthTilt + profile.moat * 2);
}

function estimateCurrentPrice(stock) {
  if (stock.price != null && Number.isFinite(Number(stock.price))) {
    return Number(stock.price);
  }
  if (stock.pe != null && Number.isFinite(Number(stock.pe)) && Number(stock.pe) > 0) {
    return Math.max(18, Math.min(250, Number(stock.pe) * 8));
  }
  return 60;
}

function inferTargetBucket(stock) {
  const revenueGrowth = Number(stock.revenueGrowth ?? 0);
  const epsGrowth = Number(stock.epsGrowth ?? 0);
  const pe = stock.pe == null ? null : Number(stock.pe);
  const margin = Number(stock.margin ?? 0);
  const debt = Number(stock.debtEquity ?? 0);
  const growthSignal = Math.max(revenueGrowth, epsGrowth);

  if (pe != null && pe <= 18 && growthSignal <= 10 && margin >= 12 && debt <= 1.2) {
    return "mature";
  }
  if (growthSignal >= 18 || (pe != null && pe <= 30 && revenueGrowth >= 12)) {
    return "growth";
  }
  if ((pe != null && pe >= 55) || debt > 1.8 || margin < 8 || growthSignal < 0) {
    return "early-stage";
  }
  return "mature";
}

function roundPrice(value) {
  return Math.round(Number(value) * 100) / 100;
}

function hydrateTargetModel(result) {
  const currentPrice = estimateCurrentPrice(result);
  const growth = Number(result.revenueGrowth ?? result.epsGrowth ?? 0);
  const quality = qualityScore(result);
  const prospects = prospectScore(result);
  const bucket = inferTargetBucket(result);
  const growthBoost = clamp(growth * 0.004, -0.06, 0.15);
  const qualityBoost = clamp((quality - 45) / 120, -0.04, 0.1);
  const moatBoost = clamp((prospects - 55) / 120, -0.03, 0.08);

  let targetMethod = "Mature business anchor: target uses conservative earnings stability and quality.";
  let bearMultiple = 1.02 + growthBoost * 0.4;
  let baseMultiple = 1.08 + growthBoost + qualityBoost * 0.25;
  let bullMultiple = 1.18 + Math.max(0, growthBoost * 0.4) + Math.max(0, qualityBoost * 0.2);

  if (bucket === "growth") {
    targetMethod = "High-growth cycle: target uses premium multiples for execution and moat strength.";
    bearMultiple = 1.08 + growthBoost * 0.3;
    baseMultiple = 1.25 + growthBoost + qualityBoost * 0.3 + moatBoost * 0.2;
    bullMultiple = 1.7 + growthBoost * 0.7 + moatBoost * 0.4;
  } else if (bucket === "early-stage") {
    targetMethod = "Early-stage or turnaround profile: target uses a wider band and tighter risk adjustment.";
    bearMultiple = 1.1 + Math.max(-0.02, growthBoost * 0.1);
    baseMultiple = 1.55 + Math.max(0, growthBoost) + Math.max(0, qualityBoost * 0.2);
    bullMultiple = 2.3 + Math.max(0, moatBoost * 0.25) + Math.max(0, qualityBoost * 0.3);
  }

  const targetBear = roundPrice(currentPrice * bearMultiple);
  const targetBase = roundPrice(currentPrice * baseMultiple);
  const targetBull = roundPrice(currentPrice * bullMultiple);
  const targetUpside = Math.round(((targetBase / currentPrice) - 1) * 100);

  return {
    ...result,
    price: currentPrice,
    currentPrice,
    targetBucket: bucket === "growth" ? "Growth" : bucket === "early-stage" ? "Early-stage" : "Mature",
    targetMethod,
    targetBear,
    targetBase,
    targetBull,
    targetPrice: targetBase,
    targetUpside,
    targetConfidence: result.score >= 75 ? "High" : result.score >= 60 ? "Medium" : "Low"
  };
}

function getWeights() {
  const macro = Number(elements.macroWeight.value);
  const fundamentals = Number(elements.fundamentalWeight.value);
  const prospects = Number(elements.prospectWeight.value);
  const total = macro + fundamentals + prospects;
  return {
    macro: macro / total,
    fundamentals: fundamentals / total,
    prospects: prospects / total
  };
}

function analyzeStock(stock) {
  const macro = macroScore(stock);
  const fundamentals = fundamentalScore(stock);
  const prospects = prospectScore(stock);
  const weights = getWeights();
  const score = Math.round(
    macro * weights.macro +
    fundamentals * weights.fundamentals +
    prospects * weights.prospects
  );
  const decision = score >= 72 ? "Buy" : score >= 55 ? "Watch" : "Avoid";
  const reasons = getReasons(stock, { macro, fundamentals, prospects, score, decision });

  return hydrateTargetModel({
    ...stock,
    sector: stock.sector || getProfile(stock).sector,
    macro: Math.round(macro),
    fundamentals: Math.round(fundamentals),
    prospects: Math.round(prospects),
    score,
    decision,
    reasons
  });
}

function getReasons(stock, scores) {
  const reasons = [];
  if (stock.error) reasons.push(stock.error);
  if (scores.macro >= 70) reasons.push("Macro conditions are supportive for risk assets.");
  if (scores.macro < 48) reasons.push("Macro sensitivity is dragging on the setup.");
  if (stock.pe !== null && stock.pe <= 18) reasons.push("Valuation is reasonable versus earnings.");
  if (stock.pe !== null && stock.pe > 40) reasons.push("Valuation requires strong growth execution.");
  if ((stock.epsGrowth ?? 0) > 15 || (stock.revenueGrowth ?? 0) > 18) reasons.push("Growth profile is materially above average.");
  if ((stock.margin ?? 18) < 8) reasons.push("Profitability is thin and needs improvement.");
  if ((stock.debtEquity ?? 0.9) > 1.5) reasons.push("Leverage is elevated relative to the model threshold.");
  if (scores.prospects >= 75) reasons.push("Company prospects and moat score are strong.");
  if (stock.online) reasons.push("Online fundamentals loaded for this symbol.");
  if (reasons.length === 0) reasons.push("Balanced profile with no single factor dominating the call.");
  return reasons;
}

function isHolding(ticker) {
  return state.holdings.some((holding) => holding.ticker === ticker);
}

function getAnalysisForTicker(ticker) {
  const fromResults = state.results.find((result) => result.ticker === ticker);
  if (fromResults) return fromResults;
  return analyzeStock({ ticker });
}

function getReplacementSuggestion(candidate) {
  if (isHolding(candidate.ticker)) {
    return {
      action: "Owned",
      label: "Already Owned",
      detail: `${candidate.ticker} is already in your purchased list.`
    };
  }

  if (!state.holdings.length) {
    return {
      action: "None",
      label: "No Holdings",
      detail: "Add purchased stocks to compare this candidate."
    };
  }

  const holdingsByScore = state.holdings
    .map((holding) => ({
      ...holding,
      analysis: getAnalysisForTicker(holding.ticker)
    }))
    .sort((a, b) => a.analysis.score - b.analysis.score);
  const weakest = holdingsByScore[0];
  const scoreGap = candidate.score - weakest.analysis.score;
  const shouldReplace = candidate.decision === "Buy" && scoreGap >= 8;

  return {
    action: shouldReplace ? "Replace" : "Hold",
    label: shouldReplace ? `Replace ${weakest.ticker}` : "Keep Current",
    detail: shouldReplace
      ? `${candidate.ticker} scores ${scoreGap} points higher than ${weakest.ticker}.`
      : `${candidate.ticker} is not enough of an upgrade over ${weakest.ticker} yet.`,
    replaceTicker: weakest.ticker,
    replaceScore: weakest.analysis.score,
    scoreGap
  };
}

function buildRecommendations() {
  state.recommendations = state.results
    .filter((result) => !isHolding(result.ticker))
    .map((candidate) => ({
      candidate,
      suggestion: getReplacementSuggestion(candidate)
    }))
    .filter((item) => item.suggestion.action === "Replace")
    .sort((a, b) => b.suggestion.scoreGap - a.suggestion.scoreGap);
}

async function monitorHoldings() {
  if (!state.holdings.length) {
    state.monitorAlerts = [];
    state.lastMonitorTime = null;
    renderMonitor();
    renderPortfolioPerformance();
    return;
  }

  // Disable buttons while refreshing
  elements.monitorBtn.disabled = true;
  elements.monitorBtn.textContent = "Refreshing...";
  elements.refreshPortfolioBtn.disabled = true;
  elements.refreshPortfolioBtn.textContent = "Refreshing...";

  try {
    const payload = await fetchOnlineStocks(state.holdings.map((holding) => holding.ticker).join(","));
    const analyses = (payload.stocks ?? []).map(analyzeStock);
    const analysisMap = new Map(analyses.map((analysis) => [analysis.ticker, analysis]));
    
    state.monitorAlerts = [];
    state.onlineErrors = payload.errors ?? [];
    
    state.holdings = state.holdings.map((holding) => updateHoldingMonitor(holding, analysisMap.get(holding.ticker)));
    state.lastMonitorTime = new Date().toISOString();
    
    mergeOwnedAnalysesIntoResults(analyses);
    buildRecommendations();
    saveState();
    saveAnalysis();
    saveHoldings();
    render();
  } catch (error) {
    state.monitorAlerts = [{
      ticker: "Monitor",
      type: "watch",
      action: "Hold",
      message: error.message || "Unable to refresh owned stocks right now.",
      detail: "Keeping the last saved holding data."
    }];
    renderMonitor();
    renderPortfolioPerformance();
  } finally {
    elements.monitorBtn.disabled = false;
    elements.monitorBtn.textContent = "Refresh Holdings";
    elements.refreshPortfolioBtn.disabled = false;
    elements.refreshPortfolioBtn.textContent = "Refresh Prices";
  }
}

function updateHoldingMonitor(holding, analysis) {
  if (!analysis || analysis.error) {
    state.monitorAlerts.push({
      ticker: holding.ticker,
      type: "watch",
      action: "Hold",
      message: "Online refresh failed for this holding.",
      detail: analysis?.error ?? "Try refreshing again later."
    });
    return holding;
  }

  const price = analysis.price ?? holding.lastPrice ?? null;
  const scoreGap = holding.lastScore == null ? 0 : analysis.score - holding.lastScore;
  const gainLossPct = price ? ((price - holding.entryPrice) / holding.entryPrice) * 100 : null;
  const marketValue = price ? price * holding.shares : null;
  const costBasis = holding.entryPrice * holding.shares;
  const pnl = marketValue == null ? null : marketValue - costBasis;
  const events = buildHoldingEvents(holding, analysis, price, scoreGap, gainLossPct);
  const action = suggestHoldingAction(holding, analysis, events);

  state.monitorAlerts.push({
    ticker: holding.ticker,
    type: action.type,
    action: action.label,
    message: action.message,
    detail: [
      price ? `Price $${formatMoney(price)}` : "Price unavailable",
      gainLossPct == null ? null : `${gainLossPct >= 0 ? "+" : ""}${gainLossPct.toFixed(1)}% since entry`,
      pnl == null ? null : `${pnl >= 0 ? "+" : "-"}$${formatMoney(Math.abs(pnl))} P/L`,
      events[0]
    ].filter(Boolean).join(" · ")
  });

  return {
    ...holding,
    lastPrice: price,
    lastScore: analysis.score,
    lastDecision: analysis.decision,
    lastRating: analysis.analystRating ?? holding.lastRating ?? null,
    lastTargetUpside: analysis.targetUpside ?? holding.lastTargetUpside ?? null,
    marketValue,
    pnl,
    gainLossPct,
    monitorAction: action.label,
    monitorMessage: action.message,
    lastChecked: new Date().toISOString()
  };
}

function buildHoldingEvents(holding, analysis, price, scoreGap, gainLossPct) {
  const events = [];
  if (price && holding.targetPrice && price >= holding.targetPrice) {
    events.push(`Target hit at $${formatMoney(holding.targetPrice)}.`);
  }
  if (price && holding.stopLoss && price <= holding.stopLoss) {
    events.push(`Stop loss hit at $${formatMoney(holding.stopLoss)}.`);
  }
  if (scoreGap <= -8) events.push(`Conviction score dropped ${Math.abs(scoreGap)} points.`);
  if (scoreGap >= 8) events.push(`Conviction score improved ${scoreGap} points.`);
  if (holding.lastRating && analysis.analystRating && holding.lastRating !== analysis.analystRating) {
    events.push(`Analyst rating changed from ${holding.lastRating} to ${analysis.analystRating}.`);
  }
  if ((analysis.targetUpside ?? 0) < -5) events.push("Average analyst target is now below current price.");
  if (gainLossPct != null && gainLossPct <= -12 && !holding.stopLoss) {
    events.push("Position is down more than 12% and has no stop loss set.");
  }
  return events;
}

function suggestHoldingAction(holding, analysis, events) {
  const targetHit = events.some((event) => event.startsWith("Target hit"));
  const stopHit = events.some((event) => event.startsWith("Stop loss hit"));
  const majorDrop = events.some((event) => event.includes("dropped"));
  const analystDownside = events.some((event) => event.includes("below current price"));

  if (stopHit || analysis.decision === "Avoid" || majorDrop || analystDownside) {
    return {
      label: "Review Sell",
      type: "sell",
      message: stopHit ? "Stop loss is triggered." : "Risk profile has weakened."
    };
  }
  if (targetHit) {
    return {
      label: "Take Profit",
      type: "target",
      message: "Target price is triggered."
    };
  }
  if (analysis.decision === "Buy" && analysis.score >= 76 && (analysis.targetUpside ?? 0) > 10) {
    return {
      label: "Hold / Add",
      type: "buy",
      message: "Conviction remains strong."
    };
  }
  return {
    label: "Hold",
    type: "watch",
    message: "No major action signal."
  };
}

function mergeOwnedAnalysesIntoResults(analyses) {
  const byTicker = new Map(state.results.map((result) => [result.ticker, result]));
  analyses.forEach((analysis) => byTicker.set(analysis.ticker, analysis));
  state.results = [...byTicker.values()].sort((a, b) => b.score - a.score);
}

async function runAnalysis() {
  let rawText = elements.tickerInput.value.trim();
  if (!rawText) {
    rawText = sampleRows.join("\n");
    elements.tickerInput.value = rawText;
  }
  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = shouldFetchOnline(rawText) ? "Fetching Online..." : "Analyzing...";
  let stocks = parseStocks(rawText);
  state.onlineErrors = [];

  if (shouldFetchOnline(rawText)) {
    try {
      const payload = await fetchOnlineStocks(rawText);
      stocks = payload.stocks?.length ? payload.stocks : stocks;
      state.onlineErrors = payload.errors ?? [];
    } catch (error) {
      state.onlineErrors = [error.message || "Online lookup failed. Using local estimates."];
    }
  }

  state.stocks = stocks;
  state.results = stocks.map(analyzeStock).sort((a, b) => b.score - a.score);
  state.selectedTicker = state.results[0]?.ticker ?? null;
  buildRecommendations();
  saveState();
  saveAnalysis();
  render();
  elements.analyzeBtn.disabled = false;
  elements.analyzeBtn.textContent = "Analyze List";
}

function decisionClass(decision) {
  return {
    Buy: "decision-buy",
    Watch: "decision-watch",
    Avoid: "decision-avoid"
  }[decision];
}

function render() {
  renderWeightLabels();
  renderSummary();
  renderHoldings();
  renderRecommendations();
  renderMonitor();
  renderTable();
  renderDetail();
  
  // Portfolio Hub rendering
  renderPortfolioPerformance();
}

function renderWeightLabels() {
  elements.macroWeightValue.textContent = `${elements.macroWeight.value}%`;
  elements.fundamentalWeightValue.textContent = `${elements.fundamentalWeight.value}%`;
  elements.prospectWeightValue.textContent = `${elements.prospectWeight.value}%`;
}

function renderSummary() {
  const counts = state.results.reduce((acc, item) => {
    acc[item.decision] += 1;
    return acc;
  }, { Buy: 0, Watch: 0, Avoid: 0 });
  const average = state.results.length
    ? Math.round(state.results.reduce((sum, item) => sum + item.score, 0) / state.results.length)
    : 0;
  elements.buyCount.textContent = counts.Buy;
  elements.watchCount.textContent = counts.Watch;
  elements.avoidCount.textContent = counts.Avoid;
  elements.averageScore.textContent = average;
}

function renderTable() {
  const filtered = state.filter === "all"
    ? state.results
    : state.results.filter((result) => result.decision === state.filter);

  elements.resultsBody.innerHTML = filtered.length
    ? filtered.map((result) => `
      <tr data-ticker="${result.ticker}" class="${result.ticker === state.selectedTicker ? "selected" : ""}" tabindex="0">
        <td class="ticker-cell">${result.ticker}<br><small>${result.sector}</small></td>
        <td><span class="decision-pill ${decisionClass(result.decision)}">${result.decision}</span></td>
        <td><strong>${result.score}</strong><div class="score-bar"><span style="width:${result.score}%"></span></div></td>
        <td>${result.macro}</td>
        <td>${result.fundamentals}</td>
        <td>${result.prospects}</td>
        <td>
          <div>${result.targetBucket || "Mature"}</div>
          <small>$${formatMoney(result.targetBase ?? result.targetPrice ?? 0)} · ${result.targetUpside ?? 0}%</small>
        </td>
        <td>${portfolioActionMarkup(result)}</td>
        <td>${result.reasons[0]}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="9">No stocks match this filter.</td></tr>`;
}

function renderHoldings() {
  elements.holdingCount.textContent = state.holdings.length;
  if (!elements.holdingsList) return;
  if (!state.holdings.length) {
    elements.holdingsList.innerHTML = `<div class="holding-empty">No purchased stocks. Add a ticker and entry price.</div>`;
    return;
  }

  const baskets = state.holdings.reduce((groups, holding) => {
    const basketName = holding.basket || "General";
    if (!groups.has(basketName)) groups.set(basketName, []);
    groups.get(basketName).push(holding);
    return groups;
  }, new Map());

  elements.holdingsList.innerHTML = `
    <div class="holdings-table-wrap">
      <table class="holdings-table">
        <thead>
          <tr>
            <th>Basket</th>
            <th>Ticker</th>
            <th>Shares</th>
            <th>Entry Price</th>
            <th>Target</th>
            <th>Stop</th>
            <th>Current</th>
            <th>Conviction</th>
            <th>Source</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${[...baskets.entries()].flatMap(([basketName, holdings]) => 
            holdings.map((holding) => {
              const analysis = getAnalysisForTicker(holding.ticker);
              const currentPrice = holding.lastPrice ?? holding.entryPrice;
              const marketValue = holding.shares * currentPrice;
              const pnl = marketValue - (holding.shares * holding.entryPrice);
              const pnlPct = holding.entryPrice > 0 ? (pnl / (holding.shares * holding.entryPrice)) * 100 : 0;
              const pnlClass = pnl >= 0 ? (pnl > 0 ? "pnl-positive" : "pnl-neutral") : "pnl-negative";
              const source = holding.sourceIdea ? holding.sourceIdea : "—";
              const targetPrice = holding.targetPrice ?? analysis.targetPrice ?? null;
              const targetDisplay = targetPrice == null ? "—" : `$${formatMoney(targetPrice)}`;
              return `
                <tr>
                  <td>${basketName}</td>
                  <td><strong>${holding.ticker}</strong></td>
                  <td>${holding.shares}</td>
                  <td>$${formatMoney(holding.entryPrice)}</td>
                  <td>${targetDisplay}</td>
                  <td>${holding.stopLoss ? `$${formatMoney(holding.stopLoss)}` : "—"}</td>
                  <td>$${formatMoney(currentPrice)}</td>
                  <td><span class="decision-pill ${decisionClass(analysis.decision)}">${analysis.score}</span></td>
                  <td>${source}</td>
                  <td>
                    <button class="remove-holding" data-remove-holding="${holding.ticker}" title="Remove ${holding.ticker}" aria-label="Remove ${holding.ticker}">×</button>
                  </td>
                </tr>
              `;
            })
          ).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMonitor() {
  if (!state.holdings.length) {
    elements.monitorHeadline.textContent = "Add holdings to monitor targets, stops, and major changes";
    elements.lastMonitorTime.textContent = "Not checked yet";
    elements.monitorAlerts.innerHTML = `<div class="alert-card watch"><strong>No owned stocks yet</strong><span>Add shares, entry price, target, and stop loss in the sidebar.</span></div>`;
    return;
  }

  const actionable = state.monitorAlerts.filter((alert) => alert.type !== "watch").length;
  elements.monitorHeadline.textContent = actionable
    ? `${actionable} owned stock alert${actionable === 1 ? "" : "s"} need review`
    : "Owned stocks look stable";
  elements.lastMonitorTime.textContent = state.lastMonitorTime
    ? `Last checked ${new Date(state.lastMonitorTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Not checked yet";
  elements.monitorAlerts.innerHTML = state.monitorAlerts.length
    ? state.monitorAlerts.map((alert) => `
      <div class="alert-card ${alert.type}">
        <strong>${alert.ticker} · ${alert.action}</strong>
        <div>${alert.message}</div>
        <span>${alert.detail}</span>
      </div>
    `).join("")
    : `<div class="alert-card watch"><strong>Ready to monitor</strong><span>Click Refresh Holdings to check prices, targets, stops, and major changes.</span></div>`;
}

function renderRecommendations() {
  if (!state.holdings.length) {
    elements.replacementHeadline.textContent = "Add purchased stocks to compare replacements";
    elements.replacementList.innerHTML = statusCards(`<div class="replacement-card hold">Your replacement suggestions will appear here after you add holdings.</div>`);
    return;
  }

  if (!state.results.length) {
    elements.replacementHeadline.textContent = "Analyze new stocks to compare against holdings";
    elements.replacementList.innerHTML = statusCards(`<div class="replacement-card hold">Paste candidate tickers, then run the analysis.</div>`);
    return;
  }

  if (!state.recommendations.length) {
    elements.replacementHeadline.textContent = "No replacement looks compelling yet";
    elements.replacementList.innerHTML = statusCards(`<div class="replacement-card hold">Current candidates do not clear the 8-point upgrade threshold over your weakest holding.</div>`);
    return;
  }

  elements.replacementHeadline.textContent = `${state.recommendations.length} replacement idea${state.recommendations.length === 1 ? "" : "s"} found`;
  elements.replacementList.innerHTML = statusCards(state.recommendations.slice(0, 3).map(({ candidate, suggestion }) => `
     <div class="replacement-card">
       <strong>${candidate.ticker}</strong> over <strong>${suggestion.replaceTicker}</strong>
       <div>${candidate.score} vs ${suggestion.replaceScore} conviction score. ${suggestion.detail}</div>
     </div>
  `).join(""));
}

function statusCards(markup) {
  const errors = state.onlineErrors.map((error) => `<div class="replacement-card hold">${error}</div>`).join("");
  return `${errors}${markup}`;
}

function portfolioActionMarkup(result) {
  const suggestion = getReplacementSuggestion(result);
  const className = {
    Replace: "action-replace",
    Hold: "action-hold",
    Owned: "action-owned",
    None: ""
  }[suggestion.action];
  return `<span class="action-pill ${className}" title="${suggestion.detail}">${suggestion.label}</span>`;
}

function renderDetail() {
  const result = state.results.find((item) => item.ticker === state.selectedTicker);
  if (!result) {
    elements.detailContent.className = "detail-empty";
    elements.detailContent.textContent = "Run an analysis, then select a row for the full score breakdown.";
    return;
  }

  const holding = state.holdings.find((item) => item.ticker === result.ticker);
  const suggestion = getReplacementSuggestion(result);
  const targetPrice = result.targetPrice ?? result.targetBase ?? result.targetBear ?? null;
  elements.detailContent.className = "detail-card";
  elements.detailContent.innerHTML = `
    <div class="big-score">
      <div>
        <strong>${result.score}</strong>
        <p>${result.ticker} conviction score</p>
      </div>
      <span class="decision-pill ${decisionClass(result.decision)}">${result.decision}</span>
    </div>
    <div class="metric-stack">
      ${metricRow("Macro", result.macro)}
      ${metricRow("Fundamentals", result.fundamentals)}
      ${metricRow("Prospects", result.prospects)}
    </div>
    <ul class="reason-list">
      <li>${holding ? `Purchased at $${formatMoney(holding.entryPrice)}.` : suggestion.detail}</li>
      ${holding?.lastPrice ? `<li>Current monitor price is $${formatMoney(holding.lastPrice)} with ${holding.monitorAction ?? "Hold"} guidance.</li>` : ""}
      ${result.reasons.map((reason) => `<li>${reason}</li>`).join("")}
    </ul>
    <div class="detail-target-block">
      <div class="detail-target-header">
        <div>
          <strong>${result.targetBucket || "Target"} cycle</strong>
          <p>${result.targetMethod || "Target model will be derived from the business type and growth cycle."}</p>
        </div>
        <span class="decision-pill ${decisionClass(result.decision)}">${result.targetConfidence || "Medium"} confidence</span>
      </div>
      <div class="editable-grid">
        ${field("Current Price", result.price ?? result.currentPrice)}
        ${field("Bear Target", result.targetBear)}
        ${field("Base Target", result.targetBase)}
        ${field("Bull Target", result.targetBull)}
        ${field("Upside %", result.targetUpside)}
        ${field("Target Price", targetPrice)}
      </div>
    </div>
    <div class="editable-grid">
      ${field("P/E", result.pe)}
      ${field("EPS Growth %", result.epsGrowth)}
      ${field("Revenue Growth %", result.revenueGrowth)}
      ${field("Margin %", result.margin)}
      ${field("Debt / Equity", result.debtEquity)}
      ${field("FCF Yield %", result.fcfYield)}
    </div>
    <button class="secondary-button" data-add-selected="${result.ticker}">${holding ? "Update Entry Price Above" : "Add to Purchased List"}</button>
  `;
}

function metricRow(label, value) {
  return `
    <div class="metric-row">
      <span>${label}</span>
      <div class="metric-track"><span style="width:${value}%"></span></div>
      <strong>${value}</strong>
    </div>
  `;
}

function field(label, value) {
  return `
    <label>
      ${label}
      <input type="number" value="${value ?? ""}" data-field="${label}" disabled />
    </label>
  `;
}

function exportCsv() {
  if (!state.results.length) return;
  const headers = ["Ticker", "Decision", "Score", "Macro", "Fundamentals", "Prospects", "Sector", "Portfolio Action", "Top Reason"];
  const rows = state.results.map((result) => [
    result.ticker,
    result.decision,
    result.score,
    result.macro,
    result.fundamentals,
    result.prospects,
    result.sector,
    getReplacementSuggestion(result).label,
    result.reasons[0]
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "stock-analysis.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function formatMoney(value) {
  if (value == null) return "0.00";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function addOrUpdateHolding(holding) {
  const existingIndex = state.holdings.findIndex((item) => item.ticker === holding.ticker);
  if (existingIndex >= 0) {
    state.holdings[existingIndex] = { 
      ...state.holdings[existingIndex], 
      ...holding, 
      purchasedAt: state.holdings[existingIndex].purchasedAt ?? holding.purchasedAt 
    };
  } else {
    state.holdings.push({ ...holding, lastScore: null, lastPrice: null, monitorAction: null });
  }
  state.holdings.sort((a, b) => a.ticker.localeCompare(b.ticker));
  
  // Clear sidebar form
  elements.holdingTickerInput.value = "";
  elements.sharesInput.value = "";
  elements.entryPriceInput.value = "";
  elements.targetPriceInput.value = "";
  elements.stopLossInput.value = "";
  elements.basketInput.value = "";
  elements.sourceIdeaInput.value = "";
  
  buildRecommendations();
  saveState();
  saveHoldings();
  render();
  monitorHoldings();
}

function removeHolding(ticker) {
  fetch(`/api/holdings/${encodeURIComponent(ticker)}`, { method: "DELETE" })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        throw new Error("Unable to remove holding from database.");
      }
      state.holdings = state.holdings.filter((holding) => holding.ticker !== ticker);
      buildRecommendations();
      saveState();
      saveHoldings();
      render();
    })
    .catch((err) => {
      console.warn("Failed to remove holding from database:", err);
    });
}

function normalizeHolding(holding) {
  return {
    ticker: normalizeTicker(holding.ticker),
    shares: Number(holding.shares ?? 1),
    entryPrice: Number(holding.entryPrice ?? 0),
    targetPrice: holding.targetPrice == null ? null : Number(holding.targetPrice),
    stopLoss: holding.stopLoss == null ? null : Number(holding.stopLoss),
    basket: holding.basket || "General",
    sourceIdea: holding.sourceIdea ?? "",
    purchasedAt: holding.purchasedAt ?? new Date().toISOString(),
    lastPrice: holding.lastPrice ?? null,
    lastScore: holding.lastScore ?? null,
    lastDecision: holding.lastDecision ?? null,
    lastRating: holding.lastRating ?? null,
    lastTargetUpside: holding.lastTargetUpside ?? null,
    marketValue: holding.marketValue ?? null,
    pnl: holding.pnl ?? null,
    gainLossPct: holding.gainLossPct ?? null,
    monitorAction: holding.monitorAction ?? null,
    monitorMessage: holding.monitorMessage ?? null,
    lastChecked: holding.lastChecked ?? null
  };
}

function updateBasketDatalist() {
  if (!elements.basketDatalist) return;
  elements.basketDatalist.innerHTML = state.baskets
    .map((b) => `<option value="${b.name}">`)
    .join("");
}

function saveState() {
  const stateData = {
    tickerInput: elements.tickerInput.value,
    macro: {
      rates: elements.ratesInput.value,
      inflation: elements.inflationInput.value,
      growth: elements.growthInput.value,
      risk: elements.riskInput.value
    },
    weights: {
      macro: elements.macroWeight.value,
      fundamentals: elements.fundamentalWeight.value,
      prospects: elements.prospectWeight.value
    },
    activeTab: state.activeTab,
    basketSort: state.basketSort,
    baskets: state.baskets
  };
  
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stateData)
  }).catch(err => console.warn("Failed to save state:", err));
}

function saveAnalysis() {
  if (!state.results.length) return;

  const normalizedResults = state.results.map((result) => hydrateTargetModel(result));

  fetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results: normalizedResults })
  }).catch(err => console.warn("Failed to save analysis:", err));
}

function saveHoldings() {
  if (!state.holdings.length) return;
  
  fetch("/api/holdings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdings: state.holdings })
  }).catch(err => console.warn("Failed to save holdings:", err));
}

function loadState() {
  setLoadStatus("Loading saved data...", "info");
  fetch("/api/state")
    .then(res => res.json())
    .then(data => {
      elements.tickerInput.value = data.tickerInput ?? sampleRows.join("\n");
      elements.ratesInput.value = data.macro?.rates ?? elements.ratesInput.value;
      elements.inflationInput.value = data.macro?.inflation ?? elements.inflationInput.value;
      elements.growthInput.value = data.macro?.growth ?? elements.growthInput.value;
      elements.riskInput.value = data.macro?.risk ?? elements.riskInput.value;
      elements.macroWeight.value = data.weights?.macro ?? elements.macroWeight.value;
      elements.fundamentalWeight.value = data.weights?.fundamentals ?? elements.fundamentalWeight.value;
      elements.prospectWeight.value = data.weights?.prospects ?? elements.prospectWeight.value;
      
      if (Array.isArray(data.baskets) && data.baskets.length > 0) {
        state.baskets = data.baskets;
      }
      state.activeTab = data.activeTab ?? "analyzer";
      state.basketSort = data.basketSort ?? "value-desc";
      
      if (!state.baskets.length) {
        state.baskets = [
          { id: "b-general", name: "General", description: "Default stock holdings", color: "slate" }
        ];
      }
      if (!state.baskets.some((basket) => basket.name.toLowerCase() === "general")) {
        state.baskets.unshift({
          id: "b-general",
          name: "General",
          description: "Default stock holdings",
          color: "slate"
        });
      }
      
      updateBasketDatalist();
      loadAnalysis();
      loadHoldings();
      switchTab(state.activeTab);
      render();
      setLoadStatus("Saved data loaded.", "success");
    })
    .catch(err => {
      console.warn("Failed to load state from database:", err);
      elements.tickerInput.value = sampleRows.join("\n");
      updateBasketDatalist();
      setLoadStatus("No saved data found. Loading sample portfolio.", "sample");
      runAnalysis();
    });
}

function loadAnalysis() {
  fetch("/api/analysis")
    .then(res => res.json())
    .then(data => {
      const savedAnalysis = Array.isArray(data.analysis) ? data.analysis : [];
      const needsBackfill = savedAnalysis.some((result) => result.price == null);
      state.results = savedAnalysis.map(hydrateTargetModel);
      state.selectedTicker = state.results[0]?.ticker ?? null;
      buildRecommendations();
      if (!state.results.length) {
        setLoadStatus("No saved analysis found. Loading sample portfolio.", "sample");
        elements.tickerInput.value = sampleRows.join("\n");
        runAnalysis();
        return;
      }
      if (needsBackfill) {
        saveAnalysis();
      }
      render();
      setLoadStatus("Saved analysis loaded.", "success");
    })
    .catch(err => {
      console.warn("Failed to load analysis from database:", err);
      setLoadStatus("Unable to load saved analysis. Loading sample data.", "sample");
      runAnalysis();
    });
}

function loadHoldings() {
  fetch("/api/holdings")
    .then(res => res.json())
    .then(data => {
      state.holdings = Array.isArray(data.holdings)
        ? data.holdings.map(normalizeHolding).filter((holding) => holding.ticker && holding.entryPrice > 0)
        : [];
      buildRecommendations();
      render();
      setLoadStatus("Saved holdings loaded.", "success");
    })
    .catch(err => {
      console.warn("Failed to load holdings from database:", err);
      setLoadStatus("Unable to load saved holdings.", "error");
    });
}

/* ==========================================================================
   PORTFOLIO HUB FUNCTIONS
   ========================================================================== */

function switchTab(tabId) {
  state.activeTab = tabId;
  saveState();

  if (tabId === "analyzer") {
    elements.tabAnalyzer.classList.add("active");
    elements.tabPortfolio.classList.remove("active");
    elements.tabAnalyzer.setAttribute("aria-selected", "true");
    elements.tabPortfolio.setAttribute("aria-selected", "false");
    
    elements.analyzerPage.classList.add("active");
    elements.portfolioPage.classList.remove("active");
  } else {
    elements.tabAnalyzer.classList.remove("active");
    elements.tabPortfolio.classList.add("active");
    elements.tabAnalyzer.setAttribute("aria-selected", "false");
    elements.tabPortfolio.setAttribute("aria-selected", "true");
    
    elements.analyzerPage.classList.remove("active");
    elements.portfolioPage.classList.add("active");
    renderPortfolioPerformance();
  }
}

// Basket Helper Calculations
function getBasketMetrics(basketName) {
  const basketHoldings = state.holdings.filter((h) => (h.basket || "General").toLowerCase() === basketName.toLowerCase());
  
  let costBasis = 0;
  let marketValue = 0;
  let scoreSum = 0;
  let weightedScoreSum = 0;
  
  basketHoldings.forEach((h) => {
    const analysis = getAnalysisForTicker(h.ticker);
    const cost = h.shares * h.entryPrice;
    const value = h.shares * (h.lastPrice ?? h.entryPrice);
    
    costBasis += cost;
    marketValue += value;
    scoreSum += analysis.score;
    weightedScoreSum += (analysis.score * value);
  });
  
  const pnl = marketValue - costBasis;
  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  const avgConviction = marketValue > 0 
    ? Math.round(weightedScoreSum / marketValue) 
    : (basketHoldings.length > 0 ? Math.round(scoreSum / basketHoldings.length) : 0);
    
  return {
    holdingsCount: basketHoldings.length,
    costBasis,
    marketValue,
    pnl,
    pnlPercent,
    avgConviction,
    holdings: basketHoldings
  };
}

function renderPortfolioPerformance() {
  if (!elements.basketGrid) return;
  if (!state.baskets.length) {
    state.baskets = [
      { id: "b-general", name: "General", description: "Default stock holdings", color: "slate" }
    ];
  }
  if (!state.baskets.some((basket) => basket.name.toLowerCase() === "general")) {
    state.baskets.unshift({
      id: "b-general",
      name: "General",
      description: "Default stock holdings",
      color: "slate"
    });
  }
  
  // 1. Calculate overall portfolio metrics
  let totalCost = 0;
  let totalValue = 0;
  let portfolioWeightedScoreSum = 0;
  let portfolioScoreSum = 0;
  
  // Aggregate from all holdings
  state.holdings.forEach((h) => {
    const analysis = getAnalysisForTicker(h.ticker);
    const cost = h.shares * h.entryPrice;
    const val = h.shares * (h.lastPrice ?? h.entryPrice);
    
    totalCost += cost;
    totalValue += val;
    portfolioScoreSum += analysis.score;
    portfolioWeightedScoreSum += (analysis.score * val);
  });
  
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const avgPortfolioScore = totalValue > 0 
    ? Math.round(portfolioWeightedScoreSum / totalValue) 
    : (state.holdings.length > 0 ? Math.round(portfolioScoreSum / state.holdings.length) : 0);
  
  // 2. Render portfolio totals
  elements.totalPortfolioCost.textContent = `$${formatMoney(totalCost)}`;
  elements.totalPortfolioValue.textContent = `$${formatMoney(totalValue)}`;
  
  const pnlEl = elements.totalPortfolioPnl;
  pnlEl.className = totalPnl >= 0 ? (totalPnl > 0 ? "pnl-positive" : "pnl-neutral") : "pnl-negative";
  pnlEl.textContent = `${totalPnl >= 0 ? "+" : ""}$${formatMoney(totalPnl)} (${totalPnlPercent >= 0 ? "+" : ""}${totalPnlPercent.toFixed(2)}%)`;
  
  elements.totalPortfolioScore.textContent = avgPortfolioScore;
  
  // 3. Compute and sort baskets
  const basketDetails = state.baskets.map((basket) => {
    const metrics = getBasketMetrics(basket.name);
    const allocationPercent = totalValue > 0 ? (metrics.marketValue / totalValue) * 100 : 0;
    return {
      ...basket,
      ...metrics,
      allocationPercent
    };
  });
  
  // Apply sorting
  const sortMode = elements.basketSortSelect.value;
  state.basketSort = sortMode;
  
  basketDetails.sort((a, b) => {
    if (sortMode === "value-desc") {
      return b.marketValue - a.marketValue;
    } else if (sortMode === "pnl-desc") {
      return b.pnlPercent - a.pnlPercent;
    } else if (sortMode === "name-asc") {
      return a.name.localeCompare(b.name);
    } else if (sortMode === "score-desc") {
      return b.avgConviction - a.avgConviction;
    }
    return 0;
  });
  
  // 4. Render basket table view
  if (basketDetails.length === 0) {
    elements.basketGrid.innerHTML = `
      <div class="empty-portfolio-state">
        <p>No stock baskets defined yet.</p>
        <button id="createFirstBasketBtn" class="primary-button" style="width: auto; padding: 0 20px;">＋ Create Custom Basket</button>
      </div>
    `;
    document.getElementById("createFirstBasketBtn")?.addEventListener("click", () => showBasketModal());
    return;
  }

  const colorThemes = {
    emerald: { border: "#1f7a5c", bg: "rgba(31, 122, 92, 0.08)" },
    sapphire: { border: "#2d638f", bg: "rgba(45, 99, 143, 0.08)" },
    amethyst: { border: "#7b4ec3", bg: "rgba(123, 78, 195, 0.08)" },
    amber: { border: "#b87614", bg: "rgba(184, 118, 20, 0.08)" },
    ruby: { border: "#b23b42", bg: "rgba(178, 59, 66, 0.08)" },
    slate: { border: "#65716b", bg: "rgba(101, 113, 107, 0.08)" }
  };

  elements.basketGrid.innerHTML = `
    <div class="basket-table-shell">
      <table class="basket-table-view">
        <thead>
          <tr>
            <th>Basket</th>
            <th>Assets</th>
            <th>Market Value</th>
            <th>Cost Basis</th>
            <th>Return</th>
            <th>Score</th>
            <th>Weight</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${basketDetails.map((b) => {
            const isExpanded = state.basketExpanded[b.name] === true;
            const pnlClass = b.pnl >= 0 ? (b.pnl > 0 ? "pnl-positive" : "pnl-neutral") : "pnl-negative";
            const theme = colorThemes[b.color] || colorThemes.slate;

            return `
              <tr class="basket-table-row ${isExpanded ? "expanded" : ""}" style="--basket-accent: ${theme.border};">
                <td>
                  <div class="basket-table-name">
                    <span class="basket-swatch" style="background: ${theme.border};"></span>
                    <div>
                      <div class="basket-table-title">${b.name}</div>
                      <div class="basket-table-meta">${b.description || "No description provided."}</div>
                    </div>
                  </div>
                </td>
                <td>${b.holdingsCount}</td>
                <td>$${formatMoney(b.marketValue)}</td>
                <td>$${formatMoney(b.costBasis)}</td>
                <td><span class="${pnlClass}">${b.pnl >= 0 ? "+" : ""}$${formatMoney(b.pnl)} (${b.pnlPercent >= 0 ? "+" : ""}${b.pnlPercent.toFixed(1)}%)</span></td>
                <td>${b.avgConviction}</td>
                <td>${b.allocationPercent.toFixed(1)}%</td>
                <td class="basket-table-actions">
                  <button class="basket-toggle-btn" data-basket-toggle="${b.name}" aria-expanded="${isExpanded}">
                    ${isExpanded ? "Hide" : "Show"}
                  </button>
                  <button class="icon-btn edit-basket" data-basket-id="${b.id}" title="Edit Basket Meta">✏️</button>
                  <button class="icon-btn delete-basket" data-basket-name="${b.name}" title="Delete Basket">🗑️</button>
                </td>
              </tr>
              <tr class="basket-detail-row ${isExpanded ? "open" : ""}">
                <td colspan="8">
                  <div class="basket-detail-panel">
                    <div class="basket-detail-header">
                      <span>${b.holdingsCount} stock${b.holdingsCount === 1 ? "" : "s"} in this basket</span>
                      <span>Use the inline actions to edit or remove positions.</span>
                    </div>
                    <div class="basket-table-wrap">
                      <table class="basket-assets-table">
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th>Shares</th>
                            <th>Entry Price</th>
                            <th>Current Price</th>
                            <th>Target</th>
                            <th>Market Value</th>
                            <th>P&amp;L</th>
                            <th>Conviction</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${b.holdings.length === 0
                            ? `<tr><td colspan="9" class="text-center">No stocks in this basket. Use the sidebar to add stocks.</td></tr>`
                            : b.holdings.map((h) => renderHoldingRow(h)).join("")
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  attachBasketGridEvents();
}

function renderHoldingRow(h) {
  const analysis = getAnalysisForTicker(h.ticker);
  const currentPrice = h.lastPrice ?? h.entryPrice;
  const mktVal = h.shares * currentPrice;
  const cost = h.shares * h.entryPrice;
  const pnl = mktVal - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const targetPrice = h.targetPrice ?? analysis.targetPrice ?? null;
  const targetText = targetPrice == null ? "—" : `$${formatMoney(targetPrice)}`;
  
  const isEditing = state.editingHoldingTicker === h.ticker;
  const pnlClass = pnl >= 0 ? (pnl > 0 ? "pnl-positive" : "pnl-neutral") : "pnl-negative";
  
  if (isEditing) {
    return `
      <tr class="inline-edit-active">
        <td class="ticker-cell">${h.ticker}</td>
        <td><input type="number" id="edit-shares-${h.ticker}" value="${h.shares}" min="0.0001" step="any" class="table-input" /></td>
        <td><input type="number" id="edit-price-${h.ticker}" value="${h.entryPrice}" min="0.01" step="0.01" class="table-input" /></td>
        <td>$${formatMoney(currentPrice)}</td>
        <td>${targetText}</td>
        <td>$${formatMoney(mktVal)}</td>
        <td><span class="${pnlClass}">${pnl >= 0 ? "+" : ""}$${formatMoney(pnl)} (${pnlPct.toFixed(1)}%)</span></td>
        <td><span class="decision-pill ${decisionClass(analysis.decision)}">${analysis.score} (${analysis.decision})</span></td>
        <td class="table-actions">
          <button class="save-inline-btn" data-save-ticker="${h.ticker}" title="Save updates">💾</button>
          <button class="cancel-inline-btn" data-cancel-ticker="${h.ticker}" title="Cancel editing">❌</button>
        </td>
      </tr>
      <tr class="inline-edit-sub-active">
        <td colspan="9">
          <div class="edit-extra-fields">
            <label>
              Stop Loss:
              <input type="number" id="edit-stop-${h.ticker}" value="${h.stopLoss ?? ""}" step="0.01" class="table-input mini" placeholder="None" />
            </label>
            <label>
              Target Price:
              <input type="number" id="edit-target-${h.ticker}" value="${h.targetPrice ?? ""}" step="0.01" class="table-input mini" placeholder="None" />
            </label>
            <label>
              Change Basket:
              <select id="edit-basket-${h.ticker}" class="table-input mini">
                ${state.baskets.map((b) => `<option value="${b.name}" ${b.name === h.basket ? "selected" : ""}>${b.name}</option>`).join("")}
              </select>
            </label>
            <label>
              Source Idea:
              <input type="text" id="edit-source-${h.ticker}" value="${h.sourceIdea ?? ""}" class="table-input mini-text" placeholder="Idea source..." />
            </label>
          </div>
        </td>
      </tr>
    `;
  }
  
  return `
    <tr>
      <td class="ticker-cell">${h.ticker}<br><small>${analysis.sector}</small></td>
      <td>${h.shares}</td>
      <td>$${formatMoney(h.entryPrice)}</td>
      <td>$${formatMoney(currentPrice)}</td>
      <td>${targetText}</td>
      <td><strong>$${formatMoney(mktVal)}</strong></td>
      <td><span class="pnl-badge ${pnlClass}">${pnl >= 0 ? "+" : ""}$${formatMoney(pnl)} (${pnlPct.toFixed(1)}%)</span></td>
      <td><span class="decision-pill ${decisionClass(analysis.decision)}" title="Score breakdown: Macro ${analysis.macro}, Fund ${analysis.fundamentals}, Prop ${analysis.prospects}">${analysis.score}</span></td>
      <td class="table-actions">
        <button class="edit-inline-btn" data-edit-ticker="${h.ticker}" title="Edit Quantities / Targets">✏️</button>
        <button class="remove-inline-btn" data-remove-ticker="${h.ticker}" title="Remove holding">🗑️</button>
      </td>
    </tr>
  `;
}

function attachBasketGridEvents() {
  if (!elements.basketGrid) return;
  
  // Expand / collapse trigger
  elements.basketGrid.querySelectorAll("[data-basket-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const basketName = btn.dataset.basketToggle;
      state.basketExpanded[basketName] = !state.basketExpanded[basketName];
      saveState();
      renderPortfolioPerformance();
    });
  });
  
  // Edit Basket
  elements.basketGrid.querySelectorAll(".edit-basket").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showBasketModal(btn.dataset.basketId);
    });
  });

  // Delete Basket
  elements.basketGrid.querySelectorAll(".delete-basket").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteBasket(btn.dataset.basketName);
    });
  });

  // Edit stock inline trigger
  elements.basketGrid.querySelectorAll(".edit-inline-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingHoldingTicker = btn.dataset.editTicker;
      renderPortfolioPerformance();
    });
  });

  // Cancel inline edit
  elements.basketGrid.querySelectorAll(".cancel-inline-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingHoldingTicker = null;
      renderPortfolioPerformance();
    });
  });

  // Save inline edits
  elements.basketGrid.querySelectorAll(".save-inline-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticker = btn.dataset.saveTicker;
      handleSaveInlineEdits(ticker);
    });
  });

  // Remove stock inline
  elements.basketGrid.querySelectorAll(".remove-inline-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm(`Are you sure you want to remove ${btn.dataset.removeTicker} from your portfolio?`)) {
        removeHolding(btn.dataset.removeTicker);
      }
    });
  });
}

function handleSaveInlineEdits(ticker) {
  const sharesVal = parseNumber(document.getElementById(`edit-shares-${ticker}`).value);
  const priceVal = parseNumber(document.getElementById(`edit-price-${ticker}`).value);
  const stopVal = parseNumber(document.getElementById(`edit-stop-${ticker}`).value);
  const targetVal = parseNumber(document.getElementById(`edit-target-${ticker}`).value);
  const basketVal = document.getElementById(`edit-basket-${ticker}`).value;
  const sourceVal = document.getElementById(`edit-source-${ticker}`).value.trim();
  
  if (sharesVal === null || sharesVal <= 0 || priceVal === null || priceVal <= 0) {
    alert("Shares and price must be valid positive numbers.");
    return;
  }
  
  const existingIndex = state.holdings.findIndex((item) => item.ticker === ticker);
  if (existingIndex >= 0) {
    state.holdings[existingIndex] = {
      ...state.holdings[existingIndex],
      shares: Number(sharesVal.toFixed(4)),
      entryPrice: Number(priceVal.toFixed(2)),
      stopLoss: stopVal && stopVal > 0 ? Number(stopVal.toFixed(2)) : null,
      targetPrice: targetVal && targetVal > 0 ? Number(targetVal.toFixed(2)) : null,
      basket: basketVal,
      sourceIdea: sourceVal
    };
    
    state.editingHoldingTicker = null;
    buildRecommendations();
    saveState();
    saveHoldings();
    render();
    monitorHoldings(); // Refresh metrics online if needed
  }
}

// Basket CRUD Operations
function showBasketModal(basketId = null) {
  elements.basketModal.style.display = "flex";
  
  if (basketId) {
    const basket = state.baskets.find((b) => b.id === basketId);
    if (basket) {
      elements.modalTitle.textContent = "Edit Stock Basket";
      elements.editBasketId.value = basket.id;
      elements.modalBasketName.value = basket.name;
      elements.modalBasketDesc.value = basket.description || "";
      
      const radio = elements.basketModal.querySelector(`input[name="basketColor"][value="${basket.color}"]`);
      if (radio) radio.checked = true;
      
      // Update custom visual select active class
      elements.basketModal.querySelectorAll(".color-preset").forEach((lbl) => {
        const rad = lbl.querySelector("input");
        if (rad.checked) lbl.classList.add("active");
        else lbl.classList.remove("active");
      });
    }
  } else {
    elements.modalTitle.textContent = "Create Stock Basket";
    elements.editBasketId.value = "";
    elements.modalBasketName.value = "";
    elements.modalBasketDesc.value = "";
    
    const radio = elements.basketModal.querySelector('input[name="basketColor"][value="emerald"]');
    if (radio) radio.checked = true;
    
    elements.basketModal.querySelectorAll(".color-preset").forEach((lbl) => {
      const rad = lbl.querySelector("input");
      if (rad.checked) lbl.classList.add("active");
      else lbl.classList.remove("active");
    });
  }
}

function closeBasketModal() {
  elements.basketModal.style.display = "none";
}

function handleSaveBasket(e) {
  e.preventDefault();
  
  const id = elements.editBasketId.value;
  const name = elements.modalBasketName.value.trim();
  const description = elements.modalBasketDesc.value.trim();
  const color = elements.basketModal.querySelector('input[name="basketColor"]:checked').value;
  
  if (!name) return;
  
  if (id) {
    // Edit existing basket
    const index = state.baskets.findIndex((b) => b.id === id);
    if (index >= 0) {
      const oldName = state.baskets[index].name;
      state.baskets[index] = { ...state.baskets[index], name, description, color };
      
      // Update holding basket names for stocks in this basket
      state.holdings = state.holdings.map((h) => {
        if (h.basket === oldName) {
          return { ...h, basket: name };
        }
        return h;
      });
    }
  } else {
    // Create new basket
    const exists = state.baskets.some((b) => b.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      alert("A basket with that name already exists.");
      return;
    }
    
    state.baskets.push({
      id: "b-" + Date.now(),
      name,
      description,
      color
    });
  }
  
  closeBasketModal();
  updateBasketDatalist();
  saveState();
  render();
}

function handleDeleteBasket(basketName) {
  if (basketName.toLowerCase() === "general") {
    alert("The General basket cannot be deleted.");
    return;
  }
  
  const basketHoldings = state.holdings.filter((h) => (h.basket || "General").toLowerCase() === basketName.toLowerCase());
  
  if (basketHoldings.length > 0) {
    if (confirm(`This basket contains ${basketHoldings.length} stocks. Deleting this basket will re-assign them to the "General" basket. Proceed?`)) {
      state.holdings = state.holdings.map((h) => {
        if ((h.basket || "General").toLowerCase() === basketName.toLowerCase()) {
          return { ...h, basket: "General" };
        }
        return h;
      });
    } else {
      return;
    }
  }
  
  state.baskets = state.baskets.filter((b) => b.name.toLowerCase() !== basketName.toLowerCase());
  updateBasketDatalist();
  saveState();
  render();
}

/* ==========================================================================
   EVENT LISTENERS WIRE UP
   ========================================================================== */

elements.analyzeBtn.addEventListener("click", runAnalysis);
elements.loadSampleBtn.addEventListener("click", () => {
  elements.tickerInput.value = sampleRows.join("\n");
  setLoadStatus("Sample portfolio loaded.", "sample");
  runAnalysis();
});
elements.exportBtn.addEventListener("click", exportCsv);
elements.clearBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to clear all data and reset the app?")) {
    localStorage.removeItem("stockAnalyzerState");
    elements.tickerInput.value = "";
    state.results = [];
    state.holdings = [];
    state.baskets = [
      { id: "b-general", name: "General", description: "Default stock holdings", color: "slate" },
      { id: "b-ai-tech", name: "AI & Tech", description: "Artificial intelligence and software leaders", color: "emerald" },
      { id: "b-dividend", name: "Income Dividends", description: "High yielding defensive stocks", color: "sapphire" }
    ];
    state.recommendations = [];
    state.monitorAlerts = [];
    state.lastMonitorTime = null;
    state.selectedTicker = null;
    state.editingHoldingTicker = null;
    state.activeTab = "analyzer";
    
    // Clear database
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tickerInput: "",
        macro: { rates: 25, inflation: 20, growth: 25, risk: 13 },
        weights: { macro: 25, fundamentals: 45, prospects: 30 },
        activeTab: "analyzer",
        basketSort: "value-desc",
        baskets: state.baskets
      })
    }).catch(err => console.warn("Failed to clear state:", err));
    
    fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] })
    }).catch(err => console.warn("Failed to clear analysis:", err));
    
    fetch("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdings: [] })
    }).catch(err => console.warn("Failed to clear holdings:", err));
    
    switchTab("analyzer");
    updateBasketDatalist();
    render();
  }
});

elements.quickAddForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const holding = parseHoldingInput();
  if (!holding) {
    alert("Please enter a valid stock symbol, shares count, and purchase price.");
    return;
  }
  addOrUpdateHolding(holding);
});

elements.qaNewBasketBtn.addEventListener("click", () => showBasketModal());

elements.monitorBtn.addEventListener("click", monitorHoldings);
elements.refreshPortfolioBtn.addEventListener("click", monitorHoldings);

[elements.ratesInput, elements.inflationInput, elements.growthInput, elements.riskInput].forEach((input) => {
  input.addEventListener("change", runAnalysis);
});

[elements.macroWeight, elements.fundamentalWeight, elements.prospectWeight].forEach((input) => {
  input.addEventListener("input", runAnalysis);
});

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderTable();
  });
});

elements.resultsBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-ticker]");
  if (!row) return;
  state.selectedTicker = row.dataset.ticker;
  render();
});

elements.resultsBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("tr[data-ticker]");
  if (!row) return;
  state.selectedTicker = row.dataset.ticker;
  render();
});

elements.holdingsList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-holding]");
  if (!button) return;
  removeHolding(button.dataset.removeHolding);
});

elements.detailContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-selected]");
  if (!button) return;
  elements.holdingTickerInput.value = button.dataset.addSelected;
  elements.entryPriceInput.focus();
  
  // Switch visual tab highlight if we are in Portfolio and clicking add
  // Switch back to analyzer page so user can add it or just scroll
  if (state.activeTab === "portfolio") {
    switchTab("analyzer");
  }
});

// Tab Switch listeners
elements.tabAnalyzer.addEventListener("click", () => switchTab("analyzer"));
elements.tabPortfolio.addEventListener("click", () => switchTab("portfolio"));

// Portfolio controls
elements.basketSortSelect.addEventListener("change", renderPortfolioPerformance);
elements.newBasketBtn.addEventListener("click", () => showBasketModal());

// Modal overlay close clicks
elements.closeModalBtn.addEventListener("click", closeBasketModal);
elements.cancelModalBtn.addEventListener("click", closeBasketModal);
elements.basketForm.addEventListener("submit", handleSaveBasket);

// Handle visual styling of radio presets in modal
elements.basketModal.querySelectorAll('input[name="basketColor"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    elements.basketModal.querySelectorAll(".color-preset").forEach((lbl) => {
      const rad = lbl.querySelector("input");
      if (rad.checked) lbl.classList.add("active");
      else lbl.classList.remove("active");
    });
  });
});

// Load state and startup
loadState();

// Refresh stock prices every 5 minutes in background
setInterval(() => {
  if (state.holdings.length) monitorHoldings();
}, 300000);
