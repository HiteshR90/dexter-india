// Persona prompts
export { getJhunjhunwalaPrompt } from './prompts/jhunjhunwala.js';
export { getDamaniPrompt } from './prompts/damani.js';
export { getContrarianPrompt } from './prompts/contrarian.js';
export { getMomentumPrompt } from './prompts/momentum.js';

// Persona runner
export { runPersona, runAllPersonas, PersonaVerdictSchema } from './personas.js';
export type { StockData, PersonaVerdict } from './personas.js';

// Debate
export { bullAgent, bearAgent, runDebate } from './debate.js';
export type { DebateResult } from './debate.js';

// Decision
export { makeDecision, StockDecisionSchema } from './decision.js';
export type { StockDecision, RiskFlags } from './decision.js';

// Orchestrator
export { analyzeStock, analyzePortfolio } from './orchestrator.js';
export type {
  Holding,
  TechnicalData,
  FundamentalData,
  FullStockAnalysis,
  PortfolioAnalysis,
} from './orchestrator.js';
